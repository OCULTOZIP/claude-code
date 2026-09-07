"""Testes do JARVIS local.

Cobrem o que nao depende do modelo: gateway, politica, confirmacao vinculada, fronteira
da area concedida, filtro de sensibilidade e o verificador de honestidade.
"""
from __future__ import annotations

import asyncio
import sys
import tempfile
import time
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "backend"))

from app.agent.orchestrator import verify_turn
from app.core.config import Config
from app.core.errors import ConfirmationInvalid, ToolError
from app.memory.store import sensitivity_check
from app.policy.engine import TurnState, params_hash
from app.runtime import Runtime
from app.tools.registry import validate


def build() -> Runtime:
    tmp = Path(tempfile.mkdtemp())
    cfg = Config(workspace=tmp / "ws", data_dir=tmp / "data")
    return Runtime.build(cfg)


def run(coro):
    return asyncio.run(coro)


def approver(rt: Runtime):
    """Fabrica um confirmador que aprova tudo, assinando com a chave DESTE runtime."""
    async def approve(prompt, phash, meta):
        return rt.policy.issue_confirmation_token(phash)
    return approve


async def deny(prompt, phash, meta):
    return None


class TestContracts(unittest.TestCase):
    def setUp(self):
        self.rt = build()

    def test_todo_contrato_tem_adaptador(self):
        # Runtime.build levanta se houver contrato sem adaptador ou vice-versa.
        self.assertEqual(len(self.rt.registry.all()), 14)

    def test_campos_obrigatorios_do_contrato(self):
        for c in self.rt.registry.all():
            self.assertTrue(c.description, c.name)
            self.assertIn("properties", c.parameters, c.name)
            self.assertIs(c.parameters.get("additionalProperties"), False, c.name)
            self.assertIn(c.risk_level, (0, 1, 2, 3), c.name)
            self.assertTrue(c.expected_result or c.risk_level == 0, c.name)

    def test_catalogo_e_deterministico(self):
        # Ordem instavel aqui derrubaria o cache de prompt a cada turno.
        a = self.rt.registry.catalog_for_model()
        b = self.rt.registry.catalog_for_model()
        self.assertEqual(a, b)
        self.assertEqual([t["name"] for t in a], sorted(t["name"] for t in a))


class TestSchema(unittest.TestCase):
    def setUp(self):
        self.c = build().registry.get("files.move")

    def test_aplica_defaults(self):
        out = validate(self.c.parameters, {"sources": ["a"], "destination_dir": "d"})
        self.assertEqual(out["on_conflict"], "rename")

    def test_rejeita_parametro_extra(self):
        with self.assertRaises(ToolError):
            validate(self.c.parameters, {"sources": ["a"], "destination_dir": "d", "x": 1})

    def test_rejeita_obrigatorio_ausente(self):
        with self.assertRaises(ToolError):
            validate(self.c.parameters, {"sources": ["a"]})

    def test_rejeita_tipo_errado(self):
        with self.assertRaises(ToolError):
            validate(self.c.parameters, {"sources": "a", "destination_dir": "d"})

    def test_rejeita_enum_invalido(self):
        with self.assertRaises(ToolError):
            validate(self.c.parameters,
                     {"sources": ["a"], "destination_dir": "d", "on_conflict": "explodir"})


class TestFronteiraDeArquivos(unittest.TestCase):
    def setUp(self):
        self.rt = build()
        self.f = self.rt.files

    def test_bloqueia_travessia(self):
        for bad in ["../fora.txt", "/etc/passwd", "a/../../fora", "../../../../etc/hosts"]:
            with self.subTest(bad=bad):
                with self.assertRaises(ToolError) as ctx:
                    self.f.resolve(bad)
                self.assertEqual(ctx.exception.code, "OUTSIDE_GRANT")

    def test_bloqueia_link_simbolico_que_escapa(self):
        alvo = Path(tempfile.mkdtemp()) / "segredo.txt"
        alvo.write_text("x")
        link = self.rt.config.workspace / "atalho"
        link.symlink_to(alvo)
        with self.assertRaises(ToolError) as ctx:
            self.f.resolve("atalho")
        self.assertEqual(ctx.exception.code, "OUTSIDE_GRANT")

    def test_aceita_dentro_da_area(self):
        self.assertTrue(str(self.f.resolve("sub/arquivo.txt")).startswith(str(self.f.root)))

    def test_delete_vai_para_lixeira_nao_apaga(self):
        self.f.create("descartavel.txt", "conteudo")
        res = self.f.delete(["descartavel.txt"])
        self.assertTrue(res["verified"])
        self.assertFalse((self.f.root / "descartavel.txt").exists())
        self.assertTrue((self.f.root / res["trashed"][0]["trash_path"]).exists())

    def test_move_verifica_o_destino(self):
        self.f.create("v1.mp4", "a")
        self.f.create("v2.mp4", "b")
        self.f.create_dir("Videos de Hoje")
        res = self.f.move(["v1.mp4", "v2.mp4"], "Videos de Hoje")
        self.assertEqual(len(res["moved"]), 2)
        self.assertTrue(res["verified"])
        self.assertEqual(res["verification_missing"], [])

    def test_create_nao_sobrescreve_por_padrao(self):
        self.f.create("x.txt", "um")
        with self.assertRaises(ToolError) as ctx:
            self.f.create("x.txt", "dois")
        self.assertEqual(ctx.exception.code, "ALREADY_EXISTS")


class TestPolitica(unittest.TestCase):
    def setUp(self):
        self.rt = build()
        self.p = self.rt.policy

    def test_nivel_2_exige_confirmacao(self):
        d = self.p.evaluate(self.rt.registry.get("files.move"),
                            {"sources": ["a"], "destination_dir": "d"}, TurnState())
        self.assertEqual(d.level, 2)
        self.assertTrue(d.needs_confirmation)

    def test_nivel_1_nao_exige(self):
        d = self.p.evaluate(self.rt.registry.get("files.create_dir"), {"path": "x"}, TurnState())
        self.assertFalse(d.needs_confirmation)

    def test_lote_grande_eleva_o_nivel(self):
        d = self.p.evaluate(self.rt.registry.get("files.move"),
                            {"sources": [str(i) for i in range(50)], "destination_dir": "d"},
                            TurnState())
        self.assertEqual(d.level, 3)
        self.assertTrue(d.escalated)

    def test_conteudo_externo_eleva_o_nivel(self):
        turn = TurnState()
        turn.taint("web.search")
        d = self.p.evaluate(self.rt.registry.get("files.create"),
                            {"path": "x", "content": "y"}, turn)
        self.assertEqual(d.level, 2)
        self.assertTrue(d.needs_confirmation)

    def test_concessao_nao_vale_com_conteudo_externo(self):
        self.p.grant("files.move")
        limpo = self.p.evaluate(self.rt.registry.get("files.move"),
                                {"sources": ["a"], "destination_dir": "d"}, TurnState())
        self.assertFalse(limpo.needs_confirmation)
        sujo = TurnState()
        sujo.taint("web.search")
        d = self.p.evaluate(self.rt.registry.get("files.move"),
                            {"sources": ["a"], "destination_dir": "d"}, sujo)
        self.assertTrue(d.needs_confirmation)

    def test_nivel_3_nunca_dispensa_confirmacao(self):
        self.p.grant("files.delete")
        d = self.p.evaluate(self.rt.registry.get("files.delete"), {"paths": ["a"]}, TurnState())
        self.assertTrue(d.needs_confirmation)

    def test_modo_restrito_forca_confirmacao_no_nivel_1(self):
        self.rt.config.restricted = True
        d = self.p.evaluate(self.rt.registry.get("files.create_dir"), {"path": "x"}, TurnState())
        self.assertTrue(d.needs_confirmation)


class TestConfirmacaoVinculada(unittest.TestCase):
    def setUp(self):
        self.rt = build()
        self.p = self.rt.policy

    def test_token_valido_passa(self):
        h = params_hash("files.move", {"a": 1}, "c1")
        self.p.verify_confirmation_token(self.p.issue_confirmation_token(h), h)

    def test_troca_de_parametros_e_rejeitada(self):
        h1 = params_hash("files.move", {"sources": ["seguro.txt"]}, "c1")
        h2 = params_hash("files.move", {"sources": ["importante.txt"]}, "c1")
        token = self.p.issue_confirmation_token(h1)
        with self.assertRaises(ConfirmationInvalid):
            self.p.verify_confirmation_token(token, h2)

    def test_assinatura_falsificada_e_rejeitada(self):
        h = params_hash("x", {}, "c1")
        token = self.p.issue_confirmation_token(h)
        forjado = token.rsplit(":", 1)[0] + ":" + "0" * 64
        with self.assertRaises(ConfirmationInvalid):
            self.p.verify_confirmation_token(forjado, h)

    def test_token_expirado_e_rejeitado(self):
        self.rt.config.confirmation_ttl_seconds = -1
        h = params_hash("x", {}, "c1")
        with self.assertRaises(ConfirmationInvalid):
            self.p.verify_confirmation_token(self.p.issue_confirmation_token(h), h)


class TestGateway(unittest.TestCase):
    def setUp(self):
        self.rt = build()
        self.g = self.rt.gateway
        self.approve = approver(self.rt)

    def test_executa_nivel_1_sem_confirmacao(self):
        r = run(self.g.execute("files.create_dir", {"path": "Testes"}, TurnState()))
        self.assertTrue(r["ok"])
        self.assertTrue((self.rt.files.root / "Testes").is_dir())

    def test_cancelar_nao_executa(self):
        self.rt.files.create("alvo.txt", "conteudo importante")
        r = run(self.g.execute("files.delete", {"paths": ["alvo.txt"]}, TurnState(), confirm=deny))
        self.assertFalse(r["ok"])
        self.assertEqual(r["error_code"], "CONFIRMATION_DENIED")
        self.assertTrue((self.rt.files.root / "alvo.txt").exists(),
                        "o arquivo NAO pode ter sido tocado apos cancelamento")

    def test_aprovar_executa(self):
        self.rt.files.create("alvo.txt", "x")
        r = run(self.g.execute("files.delete", {"paths": ["alvo.txt"]}, TurnState(),
                               confirm=self.approve))
        self.assertTrue(r["ok"])
        self.assertFalse((self.rt.files.root / "alvo.txt").exists())

    def test_confirmacao_ausente_bloqueia(self):
        r = run(self.g.execute("files.delete", {"paths": ["x"]}, TurnState(), confirm=None))
        self.assertEqual(r["error_code"], "CONFIRMATION_REQUIRED")

    def test_ferramenta_desligada_some_do_catalogo_e_e_bloqueada(self):
        self.rt.registry.set_enabled("files.create_dir", False)
        nomes = [t["name"] for t in self.rt.registry.catalog_for_model()]
        self.assertNotIn("files.create_dir", nomes)
        r = run(self.g.execute("files.create_dir", {"path": "x"}, TurnState()))
        self.assertEqual(r["error_code"], "BLOCKED")

    def test_ferramenta_inexistente(self):
        r = run(self.g.execute("sistema.formatar_disco", {}, TurnState()))
        self.assertEqual(r["error_code"], "TOOL_NOT_FOUND")

    def test_parametro_invalido_e_recusado_antes_de_executar(self):
        r = run(self.g.execute("files.create_dir", {"path": "x", "malicioso": True}, TurnState()))
        self.assertEqual(r["error_code"], "SCHEMA_VIOLATION")

    def test_idempotencia_por_call_id(self):
        t = TurnState()
        a = run(self.g.execute("files.create_dir", {"path": "Uma"}, t, call_id="fixo"))
        b = run(self.g.execute("files.create_dir", {"path": "Outra"}, t, call_id="fixo"))
        self.assertEqual(a, b)
        self.assertFalse((self.rt.files.root / "Outra").exists())

    def test_limite_de_chamadas_por_turno(self):
        t = TurnState()
        self.rt.config.max_tool_calls = 3
        codes = [run(self.g.execute("clock.now", {}, t, call_id=f"c{i}")) for i in range(5)]
        self.assertEqual(codes[-1].get("error_code"), "BLOCKED")

    def test_erro_de_adaptador_vira_resultado_honesto(self):
        r = run(self.g.execute("files.read_text", {"path": "nao-existe.txt"}, TurnState()))
        self.assertFalse(r["ok"])
        self.assertEqual(r["error_code"], "NOT_FOUND")

    def test_log_nao_guarda_conteudo_de_arquivo(self):
        segredo = "ESTE-CONTEUDO-NAO-PODE-VAZAR-NO-LOG"
        run(self.g.execute("files.create", {"path": "s.txt", "content": segredo}, TurnState()))
        blob = str(self.rt.store.audit_tail(10))
        self.assertNotIn(segredo, blob)
        self.assertIn("files.create", blob)

    def test_log_registra_escalonamento_e_confirmacao(self):
        self.rt.files.create("a.txt", "x")
        run(self.g.execute("files.delete", {"paths": ["a.txt"]}, TurnState(), confirm=self.approve))
        linha = self.rt.store.audit_tail(1)[0]
        self.assertEqual(linha["tool"], "files.delete")
        self.assertEqual(linha["confirmed"], "aprovado")
        self.assertEqual(linha["risk_level"], 3)


class TestMemoria(unittest.TestCase):
    def setUp(self):
        self.rt = build()

    def test_filtro_bloqueia_segredos(self):
        casos = [
            "minha senha: hunter2xyz",
            "sk-ant-api03-AAAAAAAAAAAAAAAAAAAA",
            "ghp_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
            "cartao 4111 1111 1111 1111",
            "CPF 123.456.789-09",
            "-----BEGIN RSA PRIVATE KEY-----",
        ]
        for c in casos:
            with self.subTest(c=c[:20]):
                self.assertIsNotNone(sensitivity_check(c))

    def test_filtro_deixa_passar_texto_normal(self):
        for c in ["Prefiro respostas curtas", "Meu projeto se chama Aurora",
                  "Reuniao toda terca as 10h"]:
            self.assertIsNone(sensitivity_check(c))

    def test_gateway_recusa_gravar_segredo(self):
        r = run(self.rt.gateway.execute(
            "memory.save",
            {"layer": "preferencia", "key": "acesso", "content": "senha: abcd1234"},
            TurnState(), confirm=approver(self.rt)))
        self.assertEqual(r["error_code"], "SENSITIVE_CONTENT")
        self.assertEqual(len(self.rt.store.all_memories()), 0)

    def test_preferencias_entram_ordenadas_no_prompt(self):
        self.rt.store.save_memory("preferencia", "zeta", "ultimo")
        self.rt.store.save_memory("preferencia", "alfa", "primeiro")
        bloco = self.rt.store.preferences_block()
        self.assertLess(bloco.index("alfa"), bloco.index("zeta"))


class TestLembretes(unittest.TestCase):
    def setUp(self):
        self.rt = build()

    def test_recusa_horario_no_passado(self):
        r = run(self.rt.gateway.execute(
            "reminders.create", {"title": "x", "when": "2020-01-01T09:00:00"}, TurnState()))
        self.assertEqual(r["error_code"], "IN_THE_PAST")

    def test_recusa_data_invalida(self):
        r = run(self.rt.gateway.execute(
            "reminders.create", {"title": "x", "when": "amanha de manha"}, TurnState()))
        self.assertEqual(r["error_code"], "BAD_TIMESTAMP")

    def test_cria_e_verifica(self):
        futuro = time.strftime("%Y-%m-%dT%H:%M:%S", time.localtime(time.time() + 86400))
        r = run(self.rt.gateway.execute(
            "reminders.create", {"title": "medico", "when": futuro}, TurnState()))
        self.assertTrue(r["ok"])
        self.assertTrue(r["verified"])


class TestHonestidade(unittest.TestCase):
    def test_afirmar_sem_executar_gera_alerta(self):
        self.assertTrue(verify_turn("Pronto, criei a pasta Testes.", ["files.list"]))
        self.assertTrue(verify_turn("Apaguei os 3 arquivos.", []))

    def test_afirmar_com_execucao_nao_alerta(self):
        self.assertFalse(verify_turn("Pronto, criei a pasta.", ["files.create_dir"]))

    def test_resposta_sem_afirmacao_nao_alerta(self):
        self.assertFalse(verify_turn("São 14h em São Paulo.", ["clock.now"]))


class TestSistema(unittest.TestCase):
    def setUp(self):
        self.rt = build()

    def test_recusa_esquema_perigoso(self):
        r = run(self.rt.gateway.execute("system.open", {"target": "file:///etc/passwd"},
                                        TurnState()))
        self.assertFalse(r["ok"])
        self.assertIn(r["error_code"], {"OUTSIDE_GRANT", "BLOCKED_SCHEME", "NOT_FOUND"})

    def test_recusa_javascript(self):
        r = run(self.rt.gateway.execute("system.open", {"target": "javascript:alert(1)"},
                                        TurnState()))
        self.assertEqual(r["error_code"], "BLOCKED_SCHEME")


if __name__ == "__main__":
    unittest.main(verbosity=2)

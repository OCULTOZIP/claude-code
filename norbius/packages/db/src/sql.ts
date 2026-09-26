import { getTableName, sql, type Column } from "drizzle-orm";

/**
 * Coluna sempre qualificada ("tabela"."coluna"). Necessário em subconsultas
 * correlacionadas: em selects de uma tabela só, o Drizzle omite o nome da
 * tabela, e dentro da subconsulta `"id"` passaria a apontar para a tabela
 * interna — silenciosamente errado.
 */
export function qualified(column: Column) {
  return sql.raw(`"${getTableName(column.table)}"."${column.name}"`);
}

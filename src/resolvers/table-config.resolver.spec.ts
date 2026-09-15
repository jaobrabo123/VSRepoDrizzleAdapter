import { pgTable, uuid as pgUuid, varchar as pgVarchar } from "drizzle-orm/pg-core";
import { cockroachTable, uuid as crdbUuid, varchar as crdbVarchar } from "drizzle-orm/cockroach-core";
import { sqliteTable, text as sqliteText } from "drizzle-orm/sqlite-core";
import { mysqlTable, varchar as mysqlVarchar } from "drizzle-orm/mysql-core";
import { AdapterErrorCode, VSRepoAdapterError } from "vsrepo";
import { resolveTableConfig } from "./table-config.resolver.js";

const pgUsers = pgTable("users", { id: pgUuid().primaryKey(), name: pgVarchar({ length: 10 }) });
const crdbUsers = cockroachTable("users", { id: crdbUuid().primaryKey(), name: crdbVarchar({ length: 10 }) });
const sqliteUsers = sqliteTable("users", { id: sqliteText().primaryKey(), name: sqliteText() });
const mysqlUsers = mysqlTable("users", { id: mysqlVarchar({ length: 36 }).primaryKey(), name: mysqlVarchar({ length: 10 }) });
const pgUsersWithoutPk = pgTable("users", { name: pgVarchar({ length: 10 }) });

describe("resolveTableConfig", () => {
    it("should be defined", () => {
        expect(resolveTableConfig).toBeDefined();
    });

    it("detecta 'postgresql' a partir de uma pgTable, sem 'overrideDialect'", () => {
        expect(resolveTableConfig(pgUsers)).toEqual({ pk: "id", dialect: "postgresql" });
    });

    it("detecta 'cockroach' a partir de uma cockroachTable, sem 'overrideDialect'", () => {
        expect(resolveTableConfig(crdbUsers)).toEqual({ pk: "id", dialect: "cockroach" });
    });

    it("detecta 'sqlite' a partir de uma sqliteTable, sem 'overrideDialect'", () => {
        expect(resolveTableConfig(sqliteUsers)).toEqual({ pk: "id", dialect: "sqlite" });
    });

    it("'overrideDialect' sempre vence a detecção, mesmo contrariando a classe real da tabela", () => {
        expect(resolveTableConfig(pgUsers, "sqlite")).toEqual({ pk: "id", dialect: "sqlite" });
        expect(resolveTableConfig(sqliteUsers, "postgresql")).toEqual({ pk: "id", dialect: "postgresql" });
        expect(resolveTableConfig(crdbUsers, "postgresql")).toEqual({ pk: "id", dialect: "postgresql" });
    });

    it("lança 'NOT_SUPPORTED' pra uma tabela de dialeto não suportado (ex.: mysqlTable) sem 'overrideDialect'", () => {
        try {
            resolveTableConfig(mysqlUsers);
            throw new Error("deveria ter lançado VSRepoAdapterError");
        } catch (err) {
            expect(err).toBeInstanceOf(VSRepoAdapterError);
            expect((err as VSRepoAdapterError).code).toBe(AdapterErrorCode.NOT_SUPPORTED);
        }
    });

    it("'overrideDialect' evita o erro 'NOT_SUPPORTED' mesmo numa tabela de dialeto não suportado", () => {
        // Não é o uso pretendido (o dialeto real do driver continua sendo MySQL), mas
        // o ponto aqui é só confirmar que 'overrideDialect' realmente pula a detecção
        // por completo, sem checar a classe da tabela.
        expect(resolveTableConfig(mysqlUsers, "postgresql")).toEqual({ pk: "id", dialect: "postgresql" });
    });

    it("lança 'INVALID_ADAPTER_CONFIG' quando a tabela não tem primary key, mesmo com dialeto detectável", () => {
        try {
            resolveTableConfig(pgUsersWithoutPk);
            throw new Error("deveria ter lançado VSRepoAdapterError");
        } catch (err) {
            expect(err).toBeInstanceOf(VSRepoAdapterError);
            expect((err as VSRepoAdapterError).code).toBe(AdapterErrorCode.INVALID_ADAPTER_CONFIG);
        }
    });
});

import os

import psycopg


def get_connection():
    """
    Cria conexão com PostgreSQL/PostGIS.

    As credenciais são fornecidas exclusivamente
    por variáveis de ambiente do servidor.
    """

    config = {
        "host": os.getenv("DB_HOST"),
        "port": os.getenv("DB_PORT", "5432"),
        "dbname": os.getenv("DB_NAME"),
        "user": os.getenv("DB_USER"),
        "password": os.getenv("DB_PASSWORD"),
        "connect_timeout": int(
            os.getenv("DB_CONNECT_TIMEOUT", "15")
        ),
    }

    sslmode = os.getenv("DB_SSLMODE", "require").strip()

    if sslmode:
        config["sslmode"] = sslmode

    return psycopg.connect(**config)


def test_connection():
    """
    Teste simples de conexão.
    Não retorna ou exibe credenciais.
    """

    with get_connection() as conn:
        with conn.cursor() as cur:

            cur.execute(
                """
                SELECT
                    current_database(),
                    current_user,
                    version();
                """
            )

            banco = cur.fetchone()

            cur.execute(
                """
                SELECT
                    extname,
                    extversion
                FROM pg_extension
                WHERE extname = 'postgis';
                """
            )

            postgis = cur.fetchone()

            return banco, postgis


if __name__ == "__main__":

    banco, postgis = test_connection()

    print("=" * 80)
    print("CONEXÃO POSTGRESQL/POSTGIS")
    print("=" * 80)

    print(f"Banco: {banco[0]}")
    print(f"Usuário: {banco[1]}")
    print(f"PostgreSQL: {banco[2]}")

    if postgis:
        print(
            f"PostGIS: {postgis[0]} {postgis[1]}"
        )
    else:
        print("PostGIS: NÃO ENCONTRADO")

    print("=" * 80)

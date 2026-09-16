import os

from dotenv import load_dotenv
import psycopg


load_dotenv()


def get_connection():
    """
    Cria uma conexão PostgreSQL/PostGIS.

    Funciona tanto com:
    - PostgreSQL local
    - PostgreSQL/PostGIS online (Neon)

    A configuração é controlada exclusivamente por variáveis de ambiente.
    """

    config = {
        "host": os.getenv("DB_HOST"),
        "port": os.getenv("DB_PORT", "5432"),
        "dbname": os.getenv("DB_NAME"),
        "user": os.getenv("DB_USER"),
        "password": os.getenv("DB_PASSWORD"),
        "connect_timeout": int(os.getenv("DB_CONNECT_TIMEOUT", "15")),
    }

    # SSL é opcional no ambiente local e obrigatório no Neon.
    sslmode = os.getenv("DB_SSLMODE", "").strip()

    if sslmode:
        config["sslmode"] = sslmode

    return psycopg.connect(**config)


def test_connection():
    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT
                    current_database(),
                    current_user,
                    inet_server_addr(),
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
    print("CONEXÃO COM POSTGRESQL/POSTGIS")
    print("=" * 80)
    print(f"Banco: {banco[0]}")
    print(f"Usuário: {banco[1]}")
    print(f"Servidor: {banco[2]}")
    print(f"PostgreSQL: {banco[3]}")

    if postgis:
        print(f"PostGIS: {postgis[0]} {postgis[1]}")
    else:
        print("PostGIS: NÃO ENCONTRADO")

    print("=" * 80)
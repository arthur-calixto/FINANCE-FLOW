"""JSON handling and output filtering for finance-flow.sh; standard library only."""
import ipaddress
import json
import re
import sys
from urllib.parse import unquote, urlsplit


def main():
    mode = sys.argv[1]
    if mode == "variables":
        print("\n".join(sorted(set(re.findall(r"\$\{([A-Z][A-Z0-9_]*)", sys.stdin.read())))))
    elif mode == "config-error":
        names = set(re.findall(r"required variable ([A-Z][A-Z0-9_]*)", sys.stdin.read()))
        for name in sorted(names):
            print(f"Variável ausente: {name}", file=sys.stderr)
        print("Configuração Compose inválida. Confira .env.production e o Compose; valores omitidos.", file=sys.stderr)
        return 1
    elif mode == "prepare":
        config = json.load(sys.stdin)
        services = config["services"]
        api = services["api"].get("environment", {})
        migration = services["migrate"].get("environment", {})
        build = services["web"]["build"].get("args", {})
        required = {name: api.get(name) for name in ("DATABASE_URL", "SUPABASE_URL")}
        required["DIRECT_URL"] = migration.get("DIRECT_URL")
        required.update({name: build.get(name) for name in ("VITE_SUPABASE_URL", "VITE_SUPABASE_PUBLISHABLE_KEY")})
        missing = [key for key, value in required.items() if not str(value or "").strip()]
        if missing:
            for name in missing:
                print(f"Variável ausente: {name}", file=sys.stderr)
            return 1
        # Collect sensitive configured values without printing the resolved config.
        hidden = set()
        for service in services.values():
            values = dict(service.get("environment", {}))
            values.update(service.get("build", {}).get("args", {}) if isinstance(service.get("build"), dict) else {})
            for name, value in values.items():
                if value and re.search(r"PASSWORD|SECRET|TOKEN|KEY|DATABASE_URL|DIRECT_URL", name):
                    value = str(value)
                    hidden.add(value)
                    if name in ("DATABASE_URL", "DIRECT_URL"):
                        password = urlsplit(value).password
                        if password:
                            hidden.update((password, unquote(password)))
        json.dump(sorted(hidden, key=len, reverse=True), sys.stdout)
    elif mode == "redact":
        with open(sys.argv[2], encoding="utf8") as handle:
            hidden = json.load(handle)
        for line in sys.stdin:
            for value in hidden:
                line = line.replace(value, "[REDACTED]")
            line = re.sub(r"postgres(?:ql)?://[^\s\"'<>]+", "[DATABASE_URL REDACTED]", line, flags=re.I)
            line = re.sub(r"Bearer\s+[^\s\"']+", "Bearer [REDACTED]", line, flags=re.I)
            line = re.sub(r"eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+", "[JWT REDACTED]", line)
            print(line, end="", flush=True)
    elif mode == "url":
        # compose port discovers the actual mapping, including dynamically assigned ports.
        address = sys.stdin.read().strip().splitlines()[0]
        host, port = address.rsplit(":", 1)
        host = host.strip("[]")
        ip = ipaddress.ip_address(host)
        if ip.is_unspecified:
            host = "127.0.0.1" if ip.version == 4 else "::1"
        if ip.version == 6:
            host = f"[{host}]"
        if not 0 < int(port) < 65536:
            return 1
        print(f"http://{host}:{int(port)}")
    elif mode == "healthy":
        content = sys.stdin.read().strip()
        rows = json.loads(content) if content.startswith("[") else [json.loads(line) for line in content.splitlines()]
        by_service = {row["Service"]: row for row in rows}
        return 0 if all(by_service.get(name, {}).get("State") == "running" and by_service[name].get("Health") == "healthy" for name in ("api", "web", "proxy")) else 1
    elif mode == "api-health":
        return 0 if json.load(sys.stdin) == {"status": "ok"} else 1
    else:
        return 2
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except KeyboardInterrupt:
        sys.exit(130)
    except (ValueError, KeyError, IndexError, OSError, TypeError):
        print("Não foi possível validar a resposta/configuração; conteúdo omitido.", file=sys.stderr)
        sys.exit(1)

"""Isolated operator tests: fake Docker/curl, never access production or its env."""
import fcntl
import json
import os
from pathlib import Path
import shutil
import signal
import subprocess
import tempfile
import time
import unittest

ROOT = Path(__file__).resolve().parents[2]
SECRET = "private-fixture-123"
CONFIG = {"services": {
    "api": {"environment": {"DATABASE_URL": f"postgresql://user:{SECRET}@db/finance", "SUPABASE_URL": "https://project.invalid"}},
    "migrate": {"environment": {"DIRECT_URL": f"postgresql://user:{SECRET}@db/finance"}},
    "web": {"build": {"args": {"VITE_SUPABASE_URL": "https://project.invalid", "VITE_SUPABASE_PUBLISHABLE_KEY": "public-fixture-key"}}},
    "proxy": {},
}}
DOCKER = '''#!/usr/bin/env python3
import json, os, sys, time
args=sys.argv[1:]
with open(os.environ['OPS_TEST_CALLS'],'a') as f:
 f.write(json.dumps({'args':args,'database_export':os.environ.get('DATABASE_URL')})+'\\n')
failure=os.environ.get('OPS_TEST_FAIL','')
if args == ['info']: sys.exit(1 if failure=='daemon' else 0)
if args == ['compose','version']: sys.exit(1 if failure=='compose' else 0)
if 'config' in args:
 if failure=='config':
  print('required variable DIRECT_URL is missing a value: private-fixture-123',file=sys.stderr);sys.exit(1)
 config=json.loads(os.environ['OPS_TEST_CONFIG'])
 if failure=='missing':config['services']['migrate']['environment']['DIRECT_URL']=''
 print(json.dumps(config))
elif 'build' in args:
 print('postgresql://u:private-fixture-123@db/finance')
 sys.exit(1 if failure=='build' else 0)
elif 'run' in args:
 print('private-fixture-123 public-fixture-key Bearer unknown-credential')
 sys.exit(1 if failure==args[-1] else 0)
elif 'port' in args: print('0.0.0.0:18080')
elif 'ps' in args:
 if '--format' in args:print(json.dumps([{'Service':s,'State':'running','Health':'healthy'} for s in ('api','web','proxy')]))
 else:print('api web proxy healthy')
elif 'logs' in args:
 print('private-fixture-123 Bearer another-token',flush=True)
 if os.environ.get('OPS_TEST_LOG_WAIT'):time.sleep(60)
elif 'up' in args:sys.exit(1 if failure=='up' else 0)
'''
CURL = '''#!/usr/bin/env python3
import os,sys
args=sys.argv[1:];path=args[args.index('--output')+1]
body='{"status":"ok"}' if args[-1].endswith('/api/health') else 'ok'
if os.environ.get('OPS_TEST_FAIL')=='api-health':body='not json'
with open(path,'w') as f:f.write(body)
print('200',end='')
'''


class OperatorTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="finance-flow-operator-")
        self.root = Path(self.temp.name)
        (self.root / "scripts").mkdir()
        self.bin = self.root / "bin"
        self.bin.mkdir()
        shutil.copy(ROOT / "finance-flow.sh", self.root)
        shutil.copy(ROOT / "scripts/finance_flow_ops.py", self.root / "scripts")
        shutil.copy(ROOT / "docker-compose.production.yml", self.root)
        (self.root / ".env.production").write_text("# Test fixture only\n")
        for name, body in (("docker", DOCKER), ("curl", CURL)):
            file = self.bin / name
            file.write_text(body)
            file.chmod(0o755)
        self.calls_file = self.root / "calls.jsonl"
        self.env = dict(os.environ, PATH=f"{self.bin}:{os.environ['PATH']}",
                        OPS_TEST_CALLS=str(self.calls_file), OPS_TEST_CONFIG=json.dumps(CONFIG),
                        DATABASE_URL="must-not-override-production")

    def tearDown(self):
        self.temp.cleanup()

    def run_script(self, *args, failure=""):
        result = subprocess.run([str(self.root / "finance-flow.sh"), *args], cwd="/tmp",
                                env=dict(self.env, OPS_TEST_FAIL=failure), text=True,
                                stdout=subprocess.PIPE, stderr=subprocess.STDOUT, timeout=15)
        self.assertNotIn(SECRET, result.stdout)
        self.assertNotIn("public-fixture-key", result.stdout)
        self.assertNotIn("unknown-credential", result.stdout)
        return result

    def calls(self):
        return [json.loads(line)["args"] for line in self.calls_file.read_text().splitlines()] if self.calls_file.exists() else []

    def test_help_without_env_or_docker(self):
        (self.root / ".env.production").unlink()
        self.assertEqual(self.run_script("help").returncode, 0)
        self.assertEqual(self.calls(), [])

    def test_invalid_command_and_log_service(self):
        for args in [("invalid",), ("logs", "--since"), ("stop", "-v")]:
            self.assertEqual(self.run_script(*args).returncode, 2)
        self.assertEqual(self.calls(), [])

    def test_missing_env(self):
        (self.root / ".env.production").unlink()
        self.assertNotEqual(self.run_script("start").returncode, 0)
        self.assertEqual(self.calls(), [])

    def test_prerequisite_and_config_failures(self):
        for failure in ("daemon", "compose", "config", "missing"):
            self.assertNotEqual(self.run_script("start", failure=failure).returncode, 0)
        self.assertFalse(any("up" in call for call in self.calls()))

    def test_config_status_health_and_no_shell_env_override(self):
        for command in ("config", "status", "health"):
            self.assertEqual(self.run_script(command).returncode, 0)
        health = self.run_script("health").stdout
        self.assertIn("Proxy: OK", health)
        self.assertIn("API: OK", health)
        rows = [json.loads(line) for line in self.calls_file.read_text().splitlines()]
        for row in rows:
            if '--env-file' in row['args']:
                self.assertIsNone(row['database_export'])

    def test_api_health_rejects_invalid_json(self):
        result = self.run_script("health", failure="api-health")
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("API: FAIL", result.stdout)

    def test_start_stop_restart_do_not_migrate_or_remove(self):
        for command in ("start", "stop", "start", "restart"):
            self.assertEqual(self.run_script(command).returncode, 0)
        self.assertFalse(any('run' in call or 'down' in call or 'build' in call for call in self.calls()))

    def test_build_does_not_start(self):
        self.assertEqual(self.run_script("build").returncode, 0)
        self.assertFalse(any('up' in call or 'run' in call for call in self.calls()))
        self.assertTrue(any(call[-3:] == ['api', 'web', 'migrate'] for call in self.calls()))

    def test_update_orders_build_migrate_status_recreate(self):
        self.assertEqual(self.run_script("update").returncode, 0)
        calls = self.calls()
        build = next(i for i, c in enumerate(calls) if 'build' in c)
        deploy = next(i for i, c in enumerate(calls) if c[-1] == 'deploy')
        status = next(i for i, c in enumerate(calls) if 'run' in c and c[-1] == 'status')
        up = next(i for i, c in enumerate(calls) if 'up' in c)
        self.assertLess(build, deploy)
        self.assertLess(deploy, status)
        self.assertLess(status, up)
        self.assertIn('--force-recreate', calls[up])

    def test_failure_aborts_update(self):
        for failure in ('build', 'deploy', 'status'):
            self.calls_file.write_text('')
            self.assertNotEqual(self.run_script('update', failure=failure).returncode, 0)
            self.assertFalse(any('up' in c for c in self.calls()))
            if failure == 'build':
                self.assertFalse(any('run' in c for c in self.calls()))
        self.assertNotEqual(self.run_script('update', failure='up').returncode, 0)

    def test_migrate_and_readonly_status(self):
        self.assertEqual(self.run_script('migrate').returncode, 0)
        self.calls_file.write_text('')
        self.assertEqual(self.run_script('migrate-status').returncode, 0)
        self.assertFalse(any(c[-1] == 'deploy' for c in self.calls()))

    def test_exclusive_lock(self):
        with open(self.root / '.finance-flow.lock', 'w') as lock:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
            self.assertNotEqual(self.run_script('update').returncode, 0)
        self.assertFalse(any('build' in c for c in self.calls()))

    def test_log_targets_and_interrupt_do_not_stop_containers(self):
        for args in [('logs',), ('logs', 'api')]:
            self.assertEqual(self.run_script(*args).returncode, 0)
        targets = [c for c in self.calls() if 'logs' in c]
        self.assertEqual(targets[0][-3:], ['api', 'web', 'proxy'])
        self.assertEqual(targets[1][-1], 'api')
        process = subprocess.Popen([str(self.root / 'finance-flow.sh'), 'logs'],
                                   env=dict(self.env, OPS_TEST_LOG_WAIT='1'), start_new_session=True,
                                   stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
        try:
            deadline = time.monotonic() + 5
            while sum('logs' in c for c in self.calls()) < 3 and time.monotonic() < deadline:
                time.sleep(0.02)
            os.killpg(process.pid, signal.SIGINT)
            output, _ = process.communicate(timeout=5)
            self.assertNotIn(SECRET, output)
            self.assertNotEqual(process.returncode, 0)
        finally:
            if process.poll() is None:
                os.killpg(process.pid, signal.SIGKILL)
                process.wait()
        self.assertFalse(any('stop' in c or 'down' in c for c in self.calls()))


if __name__ == '__main__':
    unittest.main()

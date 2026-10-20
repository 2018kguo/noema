"""Tool-free structured CLI calls shared by course authors and answer graders."""
import json
import os
from pathlib import Path
import signal
import subprocess
import tempfile
import time


def run_structured(provider, model, prompt, schema, timeout=150, cancelled=lambda: False):
    with tempfile.TemporaryDirectory(prefix='noema-model-') as temp:
        work = Path(temp)
        if provider == 'codex':
            spec, out = work / 'schema.json', work / 'result.json'
            spec.write_text(json.dumps(schema))
            command = ['codex', 'exec', '--ephemeral', '--ignore-user-config', '--skip-git-repo-check',
                       '--sandbox', 'read-only', '--color', 'never', '--output-schema', str(spec),
                       '--output-last-message', str(out), '-c', 'features.shell_tool=false',
                       '-c', 'features.apply_patch_freeform=false', '-c', 'web_search="disabled"']
            if model:
                command += ['--model', model]
            command += ['-']
        elif provider == 'claude':
            command = ['claude', '-p', '--output-format', 'json', '--json-schema', json.dumps(schema),
                       '--tools', '', '--strict-mcp-config', '--mcp-config', '{"mcpServers":{}}',
                       '--no-session-persistence', '--disable-slash-commands',
                       '--settings', '{"disableAllHooks":true}']
            if model:
                command += ['--model', model]
        else:
            raise ValueError('Choose the Codex or Claude CLI for course generation.')
        process = subprocess.Popen(command, stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                                   stderr=subprocess.PIPE, text=True, cwd=temp, start_new_session=True)
        deadline = time.monotonic() + timeout
        first = True
        try:
            while True:
                if cancelled():
                    raise InterruptedError('Course preparation was paused.')
                if time.monotonic() > deadline:
                    raise TimeoutError('The model timed out. Retry this item after checking your CLI.')
                try:
                    stdout, _ = process.communicate(prompt if first else None, timeout=1)
                    break
                except subprocess.TimeoutExpired:
                    first = False
        finally:
            if process.poll() is None:
                if os.name == 'posix':
                    os.killpg(process.pid, signal.SIGTERM)
                else:
                    process.terminate()
                try:
                    process.communicate(timeout=5)
                except subprocess.TimeoutExpired:
                    process.kill()
                    process.communicate()
        if process.returncode:
            raise ValueError(f'{provider} exited with status {process.returncode}. Check CLI login, model access and usage limits.')
        if provider == 'codex':
            if not out.is_file():
                raise ValueError('Codex did not return a structured result.')
            return json.loads(out.read_text())
        envelope = json.loads(stdout)
        if envelope.get('is_error'):
            raise ValueError('Claude reported an error. Check CLI login, model access and usage limits.')
        value = envelope.get('structured_output')
        if value is None and isinstance(envelope.get('result'), str):
            value = json.loads(envelope['result'])
        if value is None:
            raise ValueError('Claude did not return a structured result.')
        return value

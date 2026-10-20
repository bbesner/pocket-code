import sys, pathlib, time
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))
from inbox_monitor.judges import AnthropicJudge
t0 = time.time()
out = AnthropicJudge({"model": "claude-opus-5-5", "effort": "low", "max_tokens": 200, "timeout": 120}, pathlib.Path("/tmp")).ask('Reply with exactly this JSON and nothing else: {"ok": true, "judge": "anthropic"}')
print(f"anthropic {time.time()-t0:.1f}s ->", out.strip()[:120])

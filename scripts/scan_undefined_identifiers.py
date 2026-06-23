#!/usr/bin/env python3
import re
import subprocess
from pathlib import Path

# Builtins to ignore
BUILTINS = set("""
Array Date Number String Boolean Object Math JSON console window document localStorage
sessionStorage navigator fetch Headers Request Response setTimeout clearTimeout Promise
Object.prototype Symbol Map Set WeakMap WeakSet Intl URL process globalThis module exports require
process.env Buffer __dirname __filename console.warn console.error console.log
""".split())

# get git status porcelain
p = subprocess.run(["git", "status", "--porcelain"], capture_output=True, text=True)
lines = p.stdout.splitlines()
files = []
for l in lines:
    if not l: continue
    path = l[3:]
    files.append(path)

# filter js/jsx/ts/tsx files
candidates = [f for f in files if f.endswith(('.js', '.jsx', '.ts', '.tsx'))]
if not candidates:
    print('No modified/untracked JS/TS files to scan.')
    raise SystemExit(0)

identifier_re = re.compile(r"\b([A-Za-z_$][A-Za-z0-9_$]*)\b")
import_re1 = re.compile(r"^\s*import\s+([\s\S]+?)\s+from\s+['\"]")

results = {}
for fp in candidates:
    path = Path(fp)
    if not path.exists():
        continue
    text = path.read_text(encoding='utf-8')
    # remove comments
    stripped = re.sub(r"/\*.*?\*/", "", text, flags=re.DOTALL)
    stripped = re.sub(r"//.*", "", stripped)
    # find imports
    imported = set()
    for m in re.finditer(r"^\s*import\s+(?:\{([^}]+)\}|([A-Za-z_$][A-Za-z0-9_$]*)|\*\s+as\s+([A-Za-z_$][A-Za-z0-9_$]*))", stripped, flags=re.M):
        g1, g2, g3 = m.groups()
        if g1:
            for part in g1.split(','):
                imported.add(part.split('as')[-1].strip())
        if g2:
            imported.add(g2.strip())
        if g3:
            imported.add(g3.strip())
    # also capture require(...) assignments
    for m in re.finditer(r"(?:const|let|var)\s+([A-Za-z_$][A-Za-z0-9_$]*)\s*=\s*require\(", stripped):
        imported.add(m.group(1))
    # declared identifiers
    declared = set()
    for m in re.finditer(r"(?:function|class)\s+([A-Za-z_$][A-Za-z0-9_$]*)", stripped):
        declared.add(m.group(1))
    for m in re.finditer(r"(?:const|let|var)\s+([A-Za-z_$][A-Za-z0-9_$]*)", stripped):
        declared.add(m.group(1))
    # collect all tokens
    tokens = set(identifier_re.findall(stripped))
    # remove string/regex false positives: remove TS/JS keywords
    keywords = set(["const","let","var","function","return","if","else","for","while","switch","case","break","new","try","catch","finally","import","from","export","default","class","extends","super","this","throw","typeof","instanceof","in","of","await","async","yield","delete","void","continue","debugger"])
    # candidates = tokens - declared - imported - builtins - keywords
    suspects = sorted([t for t in tokens if t not in declared and t not in imported and t not in BUILTINS and t not in keywords and not re.match(r"^[A-Z][A-Za-z0-9_]*$", t)])
    # further filter: exclude common globals like 'props', 'state', 'setState'
    common_exclude = set(['props','state','setState','props','children','require','module','exports'])
    suspects = [s for s in suspects if s not in common_exclude]
    results[fp] = suspects

# print concise report
for fp, suspects in results.items():
    print(f"File: {fp}")
    if not suspects:
        print("  No suspicious undefined identifiers found (heuristic).")
    else:
        print("  Suspicious identifiers (used but not declared/imported):")
        for s in suspects[:50]:
            print(f"    - {s}")
    print()

print('Scan complete. Heuristic results may include false positives.')

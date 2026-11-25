import base64, gzip, json, io, hashlib, sys, os
base = os.path.dirname(os.path.abspath(__file__))
root = os.path.dirname(base)
p = ''.join(io.open(os.path.join(base, 'p3.b64'), encoding='utf-8').read().split())
data = json.loads(gzip.decompress(base64.b64decode(p)).decode('utf-8'))
ok = True
for path, v in data.items():
    full = os.path.join(root, path)
    s = io.open(full, encoding='utf-8').read()
    if hashlib.sha256(s.encode('utf-8')).hexdigest() != v['sha256']:
        print('SHA MISMATCH', path); ok = False; continue
    lines = s.split('\n')
    for op in sorted(v['ops'], key=lambda o: -o['start']):
        lines[op['start'] - 1:op['end']] = op['lines']
    io.open(full, 'w', encoding='utf-8').write('\n'.join(lines))
    print('patched', path)
sys.exit(0 if ok else 1)

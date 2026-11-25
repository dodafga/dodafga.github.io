import base64, gzip, json, io, hashlib, sys, os

base = os.path.dirname(os.path.abspath(__file__))
payload = io.open(os.path.join(base, 'r76-patch.b64'), encoding='utf-8').read()
payload = ''.join(payload.split())
data = json.loads(gzip.decompress(base64.b64decode(payload)).decode('utf-8'))

root = os.path.dirname(base)
ok = True
for path, v in data.items():
    full = os.path.join(root, path)
    s = io.open(full, encoding='utf-8').read()
    h = hashlib.sha256(s.encode('utf-8')).hexdigest()
    if h != v['sha256']:
        print('SHA MISMATCH', path, h)
        ok = False
        continue
    lines = s.split('\n')
    for op in sorted(v['ops'], key=lambda o: -o['start']):
        lines[op['start'] - 1:op['end']] = op['lines']
    io.open(full, 'w', encoding='utf-8').write('\n'.join(lines))
    print('patched', path)

sys.exit(0 if ok else 1)

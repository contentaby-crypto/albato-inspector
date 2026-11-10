"""Package only the unpacked Chrome extension, then verify every entry."""
import hashlib
import json
from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED

root = Path(__file__).resolve().parent.parent
manifest = json.loads((root / 'manifest.json').read_text(encoding='utf-8'))
files = [
    'manifest.json', 'content.js', 'background.js', 'popup.html',
    'popup.css', 'popup.js', 'assets/icon.svg',
    *sorted(set(manifest['icons'].values())),
]
assert manifest['manifest_version'] == 3
assert isinstance(manifest['version'], str) and manifest['version']
assert manifest['permissions'] == ['activeTab', 'storage']
assert set(manifest['host_permissions']) == {
    'https://albato.com/*', 'https://*.albato.com/*',
    'https://albato.ru/*', 'https://*.albato.ru/*',
}
assert manifest['content_scripts'][0]['js'] == ['content.js']
for filename in files:
    assert (root / filename).is_file(), filename
archive = root / 'albato-inspector-mvp.zip'
staged = archive.with_suffix('.zip.tmp')
with ZipFile(staged, 'w', ZIP_DEFLATED) as output:
    for filename in files:
        output.write(root / filename, filename)
with ZipFile(staged) as packaged:
    assert packaged.testzip() is None
    assert set(packaged.namelist()) == set(files)
    assert json.loads(packaged.read('manifest.json'))['version'] == manifest['version']
    for filename in files:
        assert hashlib.sha256(packaged.read(filename)).digest() == hashlib.sha256((root / filename).read_bytes()).digest()
staged.replace(archive)
print(f'Packed and verified {len(files)} files, version {manifest["version"]}: {archive}')

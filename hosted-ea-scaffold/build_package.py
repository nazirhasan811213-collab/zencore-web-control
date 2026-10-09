"""Build the empty 20-slot provisioning package. No cloud/Windows actions."""
import argparse
import hashlib
import json
import shutil
import zipfile
from pathlib import Path


def build(destination: Path, installer: Path) -> Path:
    source = Path(__file__).resolve().parent
    repo = source.parent
    expected = 'c3cba64d3d36c91af83e5f0730329d098f868dc9f42d4ae27784ac0865c4a5bb'
    if hashlib.sha256(installer.read_bytes()).hexdigest() != expected:
        raise ValueError('Connector 1.31 installer hash mismatch')
    if destination.exists():
        raise FileExistsError('Choose a new package destination; existing files are not overwritten')
    destination.mkdir(parents=True)
    for name in ['Assess-ZenCoreVM.ps1', 'Install-ZenCore20Slots.ps1', 'SETUP-20-SLOTS.cmd', 'README.md']:
        shutil.copy2(source / name, destination / name)
    assets = destination / 'assets'
    assets.mkdir()
    shutil.copy2(installer, assets / 'ZenCoreSetup-1.31.exe')
    shutil.copy2(repo / 'ea-local-connector' / 'ZenCoreExecutor.mq5', assets / 'ZenCoreExecutor.mq5')
    slots = []
    for index in range(1, 21):
        slot = f's{index:02d}'
        directory = destination / 'reservations' / slot
        directory.mkdir(parents=True)
        item = dict(slot=slot, windowsUser=f'zcslot{index:02d}', status='PLANNED_NOT_INSTALLED',
                    zenCoreUserId=None, accountAssigned=False, actualChannel=None,
                    connectorPaired=False, executionEnabled=False)
        (directory / 'slot-plan.json').write_text(json.dumps(item, indent=2), encoding='utf-8')
        slots.append(item)
    (destination / '20-slot-plan.json').write_text(json.dumps(dict(schemaVersion=1, slots=slots,
        slotCount=20, installedOnVm=False, capacityVerified=False), indent=2), encoding='utf-8')
    files = sorted(p for p in destination.rglob('*') if p.is_file())
    hashes = [dict(path=p.relative_to(destination).as_posix(), sha256=hashlib.sha256(p.read_bytes()).hexdigest()) for p in files]
    (destination / 'package-hashes.json').write_text(json.dumps(hashes, indent=2), encoding='utf-8')
    archive = destination.with_suffix('.zip')
    if archive.exists():
        raise FileExistsError('Archive already exists')
    with zipfile.ZipFile(archive, 'w', zipfile.ZIP_DEFLATED) as z:
        for p in sorted(destination.rglob('*')):
            if p.is_file():
                z.write(p, p.relative_to(destination))
    archive.with_suffix('.sha256').write_text(hashlib.sha256(archive.read_bytes()).hexdigest()+'  '+archive.name+'\n')
    return archive


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--installer', type=Path, required=True)
    args = parser.parse_args()
    print(build(args.output.resolve(), args.installer.resolve()))

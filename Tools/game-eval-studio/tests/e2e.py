"""Real-browser integration checks. Start the local dev/preview server before running.
Usage: python tests/e2e.py --url http://127.0.0.1:5173/
"""
import argparse
import hashlib
import json
from pathlib import Path
import zipfile
from playwright.sync_api import sync_playwright, expect

parser = argparse.ArgumentParser()
parser.add_argument('--url', default='http://127.0.0.1:5173/')
args = parser.parse_args()
ROOT = Path(__file__).resolve().parents[1]
RESULTS = ROOT / 'test-results'
RESULTS.mkdir(exist_ok=True)
checks = []
errors = []

def passed(name):
    checks.append(name)
    print('PASS ' + name)

def tab(page, name):
    page.get_by_role('navigation', name='评测制作流程').get_by_role('button', name=name).click()

def workspace(page):
    return page.evaluate("JSON.parse(localStorage.getItem('game-eval-studio.workspace.v1'))")

def wait_saved(page):
    expect(page.get_by_text('已自动保存', exact=True)).to_be_visible()
    page.wait_for_timeout(450)

with sync_playwright() as pw:
    browser = pw.chromium.launch(headless=True)
    context = browser.new_context(viewport={'width': 1440, 'height': 1000}, accept_downloads=True)
    page = context.new_page()
    page.on('pageerror', lambda e: errors.append(str(e)))
    page.on('console', lambda msg: errors.append(msg.text) if msg.type == 'error' else None)
    page.goto(args.url)
    page.wait_for_load_state('networkidle')
    expect(page.get_by_role('heading', name='GPU 地形的 LOD 连续性', exact=True)).to_be_visible()
    page.screenshot(path=str(RESULTS / 'desktop.png'), full_page=True)
    passed('initial sample is rendered with three placeholder warnings')

    page.get_by_role('button', name='新建评测任务', exact=True).click()
    dialog = page.get_by_role('dialog', name='新建评测任务')
    dialog.get_by_role('button', name='游戏 UI', exact=False).click()
    dialog.get_by_label('任务名称', exact=True).fill('背包与键盘导航评测')
    dialog.get_by_label('任务简述', exact=True).fill('为既有 Unity 游戏实现可堆叠背包和完整键盘操作。')
    dialog.get_by_role('button', name='从模板起草').click()
    expect(page.get_by_role('heading', name='背包与键盘导航评测', exact=True)).to_be_visible()
    page.get_by_label('仓库基线', exact=True).fill('https://example.com/game.git @ a1b2c3d4')
    page.get_by_label('运行入口 / 场景', exact=True).fill('Assets/Scenes/Inventory.unity')
    page.get_by_label('评测设备', exact=True).fill('Windows 11 / RTX 3060 / 16GB / 1920x1080 / Release')
    expect(page.get_by_text('标准已就绪', exact=True)).to_be_visible()
    wait_saved(page)
    page.reload()
    page.wait_for_load_state('networkidle')
    expect(page.get_by_role('heading', name='背包与键盘导航评测', exact=True)).to_be_visible()
    passed('template create, environment edit, auto-save and reload')
    tab(page, '任务设定')
    page.get_by_label('时间预算（分钟）', exact=True).fill('')
    page.reload()
    page.wait_for_load_state('networkidle')
    tab(page, '任务设定')
    expect(page.get_by_label('时间预算（分钟）', exact=True)).to_have_value('0')
    page.get_by_label('时间预算（分钟）', exact=True).fill('120')
    passed('immediate reload preserves incomplete numeric drafts through unload flushing')

    tab(page, '需求列表')
    page.get_by_label('REQ-001 需求名称', exact=True).fill('构建并启动背包场景')
    page.get_by_role('button', name='添加需求', exact=True).click()
    new_req = page.locator('#REQ-006')
    new_req.locator('summary').click()
    new_req.get_by_label('REQ-006 需求名称', exact=True).fill('临时需求')
    expect(page.get_by_text('REQ-006 尚未被规则覆盖', exact=True)).to_be_visible()
    new_req.get_by_role('button', name='删除需求', exact=True).click()
    page.get_by_role('dialog', name='删除需求').get_by_role('button', name='确认', exact=True).click()
    expect(page.get_by_text('标准已就绪', exact=True)).to_be_visible()
    passed('requirement edit, add, missing coverage and confirmed delete')

    tab(page, '评测规则')
    page.get_by_label('RULE-001 权重（%）', exact=True).fill('10')
    expect(page.get_by_text('规则权重合计 90，应为 100', exact=True)).to_be_visible()
    tab(page, '版本与导出')
    expect(page.get_by_role('button', name='冻结当前标准', exact=True)).to_be_disabled()
    tab(page, '评测规则')
    page.get_by_label('RULE-001 权重（%）', exact=True).fill('20')
    page.get_by_label('RULE-001 证据要求', exact=True).fill('PRIVATE_SECRET_42: 构建日志与连续运行录屏。')
    page.screenshot(path=str(RESULTS / 'rules.png'), full_page=True)
    passed('invalid rule weights block freezing and recover after correction')

    tab(page, '专家试评')
    expect(page.get_by_text('待完成', exact=True)).to_be_visible()
    page.get_by_label('评审专家', exact=True).fill('expert-01')
    page.get_by_label('匿名提交标识', exact=True).fill('submission-014')
    for i in range(1, 6):
        rid = f'RULE-{i:03}'
        page.get_by_role('button', name=f'{rid} 评分 4', exact=True).click()
        page.get_by_label(f'{rid} 证据与评语', exact=True).fill('run.mp4 00:12–00:38；日志正常，重复验证达标。')
    expect(page.get_by_text('通过', exact=True)).to_be_visible()
    page.get_by_role('button', name='RULE-001 评分 0', exact=True).click()
    expect(page.get_by_text('不通过：硬门槛失败', exact=True)).to_be_visible()
    page.get_by_role('button', name='RULE-001 评分 4', exact=True).click()
    page.get_by_label('RULE-002 证据与评语', exact=True).fill('')
    expect(page.get_by_text('待完成', exact=True)).to_be_visible()
    page.get_by_label('RULE-002 证据与评语', exact=True).fill('run.mp4 与数据断言报告。')
    page.screenshot(path=str(RESULTS / 'trial-review.png'), full_page=True)
    passed('trial review pending, evidence requirement, full score and gate precedence')

    tab(page, '版本与导出')
    page.get_by_label('确认专家', exact=True).fill('expert-01')
    page.get_by_label('评审说明', exact=True).fill('已校准键盘流程与数据断言，固定设备后确认。')
    page.get_by_role('button', name='冻结当前标准', exact=True).click()
    expect(page.get_by_text('v1', exact=True)).to_be_visible()
    page.screenshot(path=str(RESULTS / 'versions.png'), full_page=True)
    with page.expect_download() as zip_info:
        page.get_by_role('button', name='下载完整 ZIP', exact=True).click()
    zip_path = RESULTS / 'frozen-package.zip'
    zip_info.value.save_as(str(zip_path))
    with zipfile.ZipFile(zip_path) as package:
        manifest = json.loads(package.read('manifest.json'))
        assert manifest['status'] == 'frozen' and manifest['version'] == 1
        assert 'expert/trial-review.json' not in package.namelist()
        for name in package.namelist():
            if name.startswith('agent/'):
                assert 'PRIVATE_SECRET_42' not in package.read(name).decode('utf-8')
        assert 'PRIVATE_SECRET_42' in package.read('expert/rubric.private.json').decode('utf-8')
        for name, digest in manifest['files'].items():
            assert hashlib.sha256(package.read(name)).hexdigest() == digest
    passed('freeze and real ZIP download with private isolation and SHA-256 integrity')

    tab(page, '需求列表')
    page.get_by_label('REQ-001 需求名称', exact=True).fill('新草稿构建要求')
    tab(page, '专家试评')
    expect(page.get_by_label('评审专家', exact=True)).to_have_value('')
    expect(page.get_by_text('待完成', exact=True)).to_be_visible()
    tab(page, '版本与导出')
    expect(page.get_by_text('修改需求 REQ-001：新草稿构建要求', exact=True)).to_be_visible()
    page.get_by_label('导出版本', exact=True).select_option(label='v1 · expert-01')
    with page.expect_download() as task_info:
        page.get_by_role('button', name='仅下载任务提示', exact=True).click()
    task_info.value.save_as(str(RESULTS / 'frozen-task.md'))
    frozen_text = (RESULTS / 'frozen-task.md').read_text(encoding='utf-8')
    assert '构建并启动背包场景' in frozen_text and '新草稿构建要求' not in frozen_text
    passed('draft changes reset trial review and frozen export stays unchanged')

    page.get_by_label('搜索题库', exact=True).fill('no-matching-task')
    expect(page.get_by_text('没有匹配的任务', exact=True)).to_be_visible()
    page.get_by_label('搜索题库', exact=True).fill('')
    page.locator('.project-link').filter(has_text='GPU 地形的 LOD 连续性').click()
    tab(page, '版本与导出')
    page.reload()
    page.wait_for_load_state('networkidle')
    expect(page.get_by_role('heading', name='GPU 地形的 LOD 连续性', exact=True)).to_be_visible()
    expect(page.get_by_role('heading', name='冻结标准，交付可复用的评测包', exact=True)).to_be_visible()
    page.locator('.project-link').filter(has_text='背包与键盘导航评测').click()
    passed('search filtering and selected non-first task/page survive reload')

    page.get_by_role('button', name='复制任务', exact=True).click()
    expect(page.get_by_role('heading', name='背包与键盘导航评测（副本）', exact=True)).to_be_visible()
    tab(page, '专家试评')
    expect(page.get_by_label('评审专家', exact=True)).to_have_value('')
    tab(page, '版本与导出')
    expect(page.get_by_text('尚无冻结版本。先完成质量检查，再由专家确认。', exact=True)).to_be_visible()
    page.get_by_role('button', name='删除任务', exact=True).click()
    page.get_by_role('dialog', name='删除任务').get_by_role('button', name='取消', exact=True).click()
    expect(page.get_by_role('heading', name='背包与键盘导航评测（副本）', exact=True)).to_be_visible()
    page.get_by_role('button', name='删除任务', exact=True).click()
    page.get_by_role('dialog', name='删除任务').get_by_role('button', name='确认', exact=True).click()
    expect(page.get_by_role('heading', name='背包与键盘导航评测', exact=True)).to_be_visible()
    passed('copy keeps definitions but clears reviews/versions; delete supports cancel and confirm')

    wait_saved(page)
    with page.expect_download() as backup_info:
        page.get_by_role('button', name='备份', exact=True).click()
    backup_path = RESULTS / 'workspace-backup.json'
    backup_info.value.save_as(str(backup_path))
    backup_data = json.loads(backup_path.read_text(encoding='utf-8'))
    assert len(backup_data['projects']) == 2
    page.locator('input[type=file]').set_input_files(str(backup_path))
    expect(page.get_by_text('已导入 2 个任务，现有任务未覆盖。', exact=True)).to_be_visible()
    wait_saved(page)
    assert len(workspace(page)['projects']) == 4
    assert len(set(p['id'] for p in workspace(page)['projects'])) == 4
    page.locator('input[type=file]').set_input_files({'name': 'bad.json', 'mimeType': 'application/json', 'buffer': b'{"schemaVersion":2,"projects":[]}'})
    expect(page.get_by_role('dialog', name='导入失败')).to_be_visible()
    page.get_by_role('dialog', name='导入失败').get_by_role('button', name='确认', exact=True).click()
    assert len(workspace(page)['projects']) == 4
    passed('backup round trip merges with new IDs; malformed imports keep existing data')

    for width, height in [(375, 812), (768, 1024), (1024, 768), (1440, 1000)]:
        page.set_viewport_size({'width': width, 'height': height})
        for name in ['任务设定', '需求列表', '评测规则', '专家试评', '版本与导出']:
            tab(page, name)
            assert page.evaluate('document.documentElement.scrollWidth <= window.innerWidth'), (width, name)
        if width == 375:
            page.screenshot(path=str(RESULTS / 'mobile.png'), full_page=True)
    page.emulate_media(reduced_motion='reduce')
    assert page.evaluate("getComputedStyle(document.querySelector('button')).transitionDuration") == '0s'
    passed('all five pages fit 375/768/1024/1440 widths; reduced motion is honored')

    page.get_by_role('button', name='新建评测任务', exact=True).click()
    page.keyboard.press('Escape')
    expect(page.get_by_role('dialog')).to_have_count(0)
    assert page.evaluate("document.activeElement.textContent.includes('新建评测任务')")
    passed('native dialog Escape handling and focus restoration')

    page.set_viewport_size({'width': 1440, 'height': 1000})
    other = context.new_page()
    other.goto(args.url)
    other.wait_for_load_state('networkidle')
    tab(other, '任务设定')
    other.get_by_label('任务名称', exact=True).fill('另一个标签的新名称')
    wait_saved(other)
    expect(page.get_by_text('其他标签已修改或清空题库，自动保存暂停。请先备份当前改动，再载入最新数据。', exact=True)).to_be_visible()
    assert workspace(page)['projects'][0]['task']['title'] == '另一个标签的新名称'
    page.get_by_role('button', name='载入最新数据', exact=True).click()
    expect(page.get_by_role('heading', name='另一个标签的新名称', exact=True)).to_be_visible()
    other.close()
    passed('cross-tab conflict pauses saving and can load the latest workspace')

    corrupt_context = browser.new_context()
    corrupt = corrupt_context.new_page()
    corrupt.goto(args.url)
    corrupt.wait_for_load_state('networkidle')
    wait_saved(corrupt)
    corrupt.evaluate("localStorage.setItem('game-eval-studio.workspace.v1', '{broken')")
    corrupt.reload()
    expect(corrupt.get_by_text('本地题库无法读取：文件不是有效的 JSON。 原数据未覆盖，请先下载原始数据备份。', exact=True)).to_be_visible()
    assert corrupt.evaluate("localStorage.getItem('game-eval-studio.workspace.v1')") == '{broken'
    corrupt_context.close()
    passed('corrupt local storage is preserved and recovery controls are visible')

    quota_context = browser.new_context()
    quota_context.add_init_script("const original = Storage.prototype.setItem; Storage.prototype.setItem = function(k, v) { if (k === 'game-eval-studio.workspace.v1') throw new DOMException('quota','QuotaExceededError'); return original.call(this,k,v); };")
    quota = quota_context.new_page()
    quota.goto(args.url)
    expect(quota.get_by_text('浏览器存储不可用或容量不足。当前改动仅保留在内存，请下载工作区备份。', exact=True)).to_be_visible()
    quota_context.close()
    passed('storage quota failure shows truthful unsaved-data feedback')

    blocked_context = browser.new_context()
    blocked_context.add_init_script("const get = Storage.prototype.getItem; Storage.prototype.getItem = function(k) { if (k === 'game-eval-studio.workspace.v1') throw new DOMException('blocked','SecurityError'); return get.call(this,k); };")
    blocked = blocked_context.new_page()
    blocked.on('pageerror', lambda e: errors.append(str(e)))
    blocked.goto(args.url)
    expect(blocked.get_by_role('alert')).to_be_visible()
    blocked.get_by_role('button', name='下载原始存储', exact=True).click()
    expect(blocked.get_by_role('dialog', name='读取原始存储失败')).to_be_visible()
    blocked.get_by_role('dialog', name='读取原始存储失败').get_by_role('button', name='确认', exact=True).click()
    blocked.get_by_role('button', name='用当前题库继续保存', exact=True).click()
    blocked.get_by_role('dialog', name='继续保存当前题库').get_by_role('button', name='确认', exact=True).click()
    expect(blocked.get_by_text('浏览器禁止读取本地存储，无法恢复自动保存。请先下载当前题库备份。', exact=True)).to_be_visible()
    blocked_context.close()
    passed('storage read denial has usable recovery feedback without unhandled errors')

    assert not errors, errors
    passed('no unhandled JavaScript errors or console errors in the main workflow')
    context.close()
    browser.close()

(RESULTS / 'e2e-report.json').write_text(json.dumps({'url': args.url, 'passed': len(checks), 'checks': checks, 'errors': errors}, ensure_ascii=False, indent=2), encoding='utf-8')
print(f'{len(checks)} browser checks passed')

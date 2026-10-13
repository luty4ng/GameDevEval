"""Verify a live deployment through an SSH tunnel, with a dedicated disposable account."""
import argparse
import hashlib
import json
from pathlib import Path
import zipfile
from playwright.sync_api import sync_playwright, expect

parser = argparse.ArgumentParser()
parser.add_argument('--probe', required=True)
parser.add_argument('--url', default='http://127.0.0.1:3000/')
args = parser.parse_args()
probe = json.loads(Path(args.probe).read_text())
results = Path(__file__).resolve().parents[1] / 'test-results'
results.mkdir(exist_ok=True)
errors = []
with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    context = browser.new_context(viewport={'width': 1440, 'height': 1000}, accept_downloads=True)
    page = context.new_page()
    page.on('pageerror', lambda error: errors.append(str(error)))
    page.goto(args.url)
    page.wait_for_load_state('networkidle')
    expect(page.get_by_role('heading', name='登录评测工作台')).to_be_visible()
    page.get_by_label('邮箱', exact=True).fill(probe['email'])
    page.get_by_label('密码', exact=True).fill(probe['password'])
    page.get_by_role('button', name='登录', exact=True).click()
    page.get_by_role('button', name='新建评测任务', exact=True).click()
    modal = page.get_by_role('dialog', name='新建评测任务')
    modal.get_by_label('任务名称', exact=True).fill('服务器部署验收任务')
    modal.get_by_label('任务简述', exact=True).fill('仅验证平台部署流程，不代表实际游戏或专家评测结果。')
    expect(modal.get_by_label('难度', exact=True)).to_have_value('专家')
    modal.get_by_role('button', name='从模板起草').click()
    expect(page.get_by_label('引擎', exact=True)).to_have_value('Godot')
    page.get_by_label('仓库基线', exact=True).fill('deployment-fixture @ abcd1234')
    page.get_by_label('运行入口 / 场景', exact=True).fill('res://Main.tscn')
    page.get_by_label('评测设备', exact=True).fill('部署测试设备 / 固定输入 / 1920x1080')
    expect(page.get_by_text('标准已就绪', exact=True)).to_be_visible()
    expect(page.get_by_text('已自动保存', exact=True)).to_be_visible()
    page.reload()
    expect(page.get_by_role('heading', name='服务器部署验收任务', exact=True)).to_be_visible()
    page.get_by_role('navigation', name='评测制作流程').get_by_role('button', name='版本与导出', exact=True).click()
    page.get_by_label('确认专家', exact=True).fill('部署自动验收')
    page.get_by_label('评审说明', exact=True).fill('模拟题目，仅验证冻结和导出流程')
    page.get_by_role('button', name='冻结当前标准', exact=True).click()
    expect(page.get_by_text('v1', exact=True)).to_be_visible()
    expect(page.get_by_text('已自动保存', exact=True)).to_be_visible()
    page.screenshot(path=str(results / 'deployed-desktop.png'), full_page=True)
    with page.expect_download() as pending:
        page.get_by_role('button', name='下载完整 ZIP', exact=True).click()
    output = results / 'deployed-package.zip'
    pending.value.save_as(str(output))
    with zipfile.ZipFile(output) as archive:
        manifest = json.loads(archive.read('manifest.json'))
        assert manifest['status'] == 'frozen' and manifest['version'] == 1
        for name, digest in manifest['files'].items():
            assert hashlib.sha256(archive.read(name)).hexdigest() == digest
        assert 'expert/rubric.private.json' in archive.namelist()
    for width in (375, 768, 1024, 1440):
        page.set_viewport_size({'width': width, 'height': 1000})
        assert page.evaluate('document.documentElement.scrollWidth <= innerWidth + 1')
        if width == 375:
            page.screenshot(path=str(results / 'deployed-mobile.png'), full_page=True)
    page.once('dialog', lambda dialog: dialog.accept())
    page.get_by_role('button', name='退出', exact=True).click()
    expect(page.get_by_role('heading', name='登录评测工作台')).to_be_visible()
    assert not errors, errors
    context.close()
    browser.close()
print('PASS live Chromium login, defaults, editing, reload, freeze, real ZIP hashes, responsive layout and logout')

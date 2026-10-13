"""Run against tests/browser-server.ts after npm run build:server."""
from pathlib import Path
from playwright.sync_api import sync_playwright, expect

root = Path(__file__).resolve().parents[1]
url = 'http://127.0.0.1:3000/'
password = 'browser-test-password-739'
checks = []
errors = []

def passed(name):
    checks.append(name)
    print('PASS ' + name)

def account(page):
    page.get_by_role('button', name='账户与配置 ·', exact=False).click()
    return page.get_by_role('dialog', name='账户与配置')

def login(page, email, value=password):
    page.get_by_label('邮箱', exact=True).fill(email)
    page.get_by_label('密码', exact=True).fill(value)
    page.get_by_role('button', name='登录', exact=True).click()
    expect(page.get_by_role('button', name='新建评测任务', exact=True)).to_be_visible()

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    admin_context = browser.new_context(viewport={'width': 1440, 'height': 1000})
    admin = admin_context.new_page()
    admin.on('pageerror', lambda e: errors.append(str(e)))
    admin.goto(url)
    admin.wait_for_load_state('networkidle')
    expect(admin.get_by_role('heading', name='登录评测工作台')).to_be_visible()
    passed('server build requires authentication')
    login(admin, 'admin@example.test')
    modal = account(admin)
    modal.get_by_label('邀请邮箱').fill('expert@example.test')
    modal.get_by_role('button', name='创建邀请').click()
    link = modal.get_by_label('新邀请链接（请复制保存）')
    expect(link).to_be_visible()
    invite_url = link.input_value()
    passed('admin creates an email-bound invite from the UI')
    context = browser.new_context(viewport={'width': 1440, 'height': 1000}, accept_downloads=True)
    page = context.new_page()
    page.on('pageerror', lambda e: errors.append(str(e)))
    page.goto(invite_url)
    page.wait_for_load_state('networkidle')
    expect(page.get_by_role('heading', name='接受专家邀请')).to_be_visible()
    page.get_by_label('显示名称', exact=True).fill('领域专家')
    page.get_by_label('邮箱', exact=True).fill('expert@example.test')
    page.get_by_label('密码', exact=True).fill(password)
    page.get_by_label('确认密码', exact=True).fill(password)
    page.get_by_role('button', name='注册账户', exact=True).click()
    expect(page.get_by_text('注册成功，请使用邮箱和密码登录。', exact=True)).to_be_visible()
    assert '#invite=' not in page.url
    login(page, 'expert@example.test')
    expect(page.get_by_text('从模板创建第一道评测题', exact=True)).to_be_visible()
    passed('invited expert registers and opens an empty private workspace')

    modal = account(page)
    expect(modal.get_by_role('heading', name='用户管理', exact=True)).to_have_count(0)
    modal.get_by_label('显示名称', exact=True).fill('专家 Alice')
    modal.get_by_label('默认引擎', exact=True).fill('Godot')
    modal.get_by_label('默认引擎版本', exact=True).fill('4.5')
    modal.get_by_label('默认难度', exact=True).select_option('专家')
    modal.get_by_label('默认时间预算（分钟）', exact=True).fill('60')
    modal.get_by_label('默认通过阈值', exact=True).fill('80')
    modal.get_by_role('button', name='保存配置', exact=True).click()
    expect(modal.get_by_text('个人资料与默认配置已保存。', exact=True)).to_be_visible()
    modal.get_by_role('button', name='关闭对话框', exact=True).click()
    page.get_by_role('button', name='新建评测任务', exact=True).click()
    modal = page.get_by_role('dialog', name='新建评测任务')
    modal.get_by_label('任务名称', exact=True).fill('账户题库可用性验证')
    modal.get_by_label('任务简述', exact=True).fill('验证游戏玩法任务可跨设备编辑与保存。')
    expect(modal.get_by_label('难度', exact=True)).to_have_value('专家')
    modal.get_by_role('button', name='从模板起草').click()
    expect(page.get_by_role('heading', name='账户题库可用性验证', exact=True)).to_be_visible()
    expect(page.get_by_label('引擎', exact=True)).to_have_value('Godot')
    expect(page.get_by_label('时间预算（分钟）', exact=True)).to_have_value('60')
    expect(page.get_by_label('通过阈值（0–100）', exact=True)).to_have_value('80')
    expect(page.get_by_text('已自动保存', exact=True)).to_be_visible()
    assert page.evaluate("localStorage.getItem('game-eval-studio.workspace.v1')") is None
    page.reload()
    page.wait_for_load_state('networkidle')
    expect(page.get_by_role('heading', name='账户题库可用性验证', exact=True)).to_be_visible()
    passed('defaults apply to new tasks and PostgreSQL persists edits without local workspace storage')

    second_context = browser.new_context()
    second = second_context.new_page()
    second.goto(url)
    login(second, 'expert@example.test')
    expect(second.get_by_role('heading', name='账户题库可用性验证', exact=True)).to_be_visible()
    second.get_by_role('navigation', name='评测制作流程').get_by_role('button', name='任务设定', exact=True).click()
    second.get_by_label('任务名称', exact=True).fill('另一设备的题目')
    expect(second.get_by_text('已自动保存', exact=True)).to_be_visible()
    page.get_by_role('navigation', name='评测制作流程').get_by_role('button', name='任务设定', exact=True).click()
    page.get_by_label('任务名称', exact=True).fill('当前设备未保存草稿')
    expect(page.get_by_role('alert').filter(has_text='题库已在其他设备更新')).to_be_visible()
    with page.expect_download() as pending:
        page.get_by_role('button', name='备份当前题库', exact=True).click()
    destination = root / 'test-results' / 'account-conflict-backup.json'
    pending.value.save_as(str(destination))
    assert '当前设备未保存草稿' in destination.read_text(encoding='utf-8')
    page.get_by_role('button', name='载入最新数据', exact=True).click()
    expect(page.get_by_role('heading', name='另一设备的题目', exact=True)).to_be_visible()
    passed('multi-device conflict preserves unsaved work for backup and can load the latest server revision')

    # Exercise network recovery without overwriting an unseen server update.
    page.get_by_label('任务名称', exact=True).fill('离线草稿')
    context.set_offline(True)
    expect(page.get_by_role('alert').filter(has_text='无法连接服务器')).to_be_visible()
    context.set_offline(False)
    page.get_by_role('button', name='用当前题库继续保存', exact=True).click()
    modal = page.get_by_role('dialog', name='继续保存当前题库')
    modal.get_by_role('button', name='确认', exact=True).click()
    expect(page.get_by_text('已自动保存', exact=True)).to_be_visible()
    page.reload()
    expect(page.get_by_role('heading', name='离线草稿', exact=True)).to_be_visible()
    passed('offline failure pauses saving and recovers after explicit retry')

    modal = account(page)
    modal.get_by_label('当前密码', exact=True).fill(password)
    modal.get_by_label('新密码', exact=True).fill(password + '-new')
    modal.get_by_label('再次输入新密码', exact=True).fill(password + '-new')
    modal.get_by_role('button', name='更新密码', exact=True).click()
    expect(modal.get_by_text('密码已更新，其他设备的会话已撤销。', exact=True)).to_be_visible()
    modal.get_by_role('button', name='关闭对话框', exact=True).click()
    second.reload()
    expect(second.get_by_role('heading', name='登录评测工作台')).to_be_visible()
    passed('password update revokes another browser session')

    admin.get_by_role('button', name='关闭对话框', exact=True).click()
    admin.reload()
    expect(admin.get_by_text('从模板创建第一道评测题', exact=True)).to_be_visible()
    modal = account(admin)
    row = modal.locator('.account-row').filter(has_text='expert@example.test').first
    admin.once('dialog', lambda dialog: dialog.accept())
    row.get_by_role('button', name='停用', exact=True).click()
    expect(row.get_by_text('expert@example.test · 已停用', exact=True)).to_be_visible()
    page.reload()
    expect(page.get_by_role('heading', name='登录评测工作台')).to_be_visible()
    admin.once('dialog', lambda dialog: dialog.accept())
    row.get_by_role('button', name='启用', exact=True).click()
    login(page, 'expert@example.test', password + '-new')
    passed('administrator cannot see member tasks and can disable and re-enable their access')

    for width in (375, 768, 1024, 1440):
        page.set_viewport_size({'width': width, 'height': 1000})
        page.wait_for_timeout(120)
        assert page.evaluate('document.documentElement.scrollWidth <= innerWidth + 1'), f'Overflow at {width}'
    page.set_viewport_size({'width': 1440, 'height': 1000})
    modal = account(page)
    for width in (375, 768):
        page.set_viewport_size({'width': width, 'height': 1000})
        assert modal.evaluate('(el) => el.scrollWidth <= el.clientWidth + 1'), f'Account modal overflow at {width}'
    page.set_viewport_size({'width': 1440, 'height': 1000})
    page.screenshot(path=str(root / 'docs' / 'screenshots' / 'accounts.png'))
    modal.get_by_role('button', name='关闭对话框', exact=True).click()
    page.once('dialog', lambda dialog: dialog.accept())
    page.get_by_role('button', name='退出', exact=True).click()
    expect(page.get_by_role('heading', name='登录评测工作台')).to_be_visible()
    passed('responsive layouts and logout work; account screenshot captured')
    assert not errors, errors
    second_context.close()
    context.close()
    admin_context.close()
    browser.close()
print(f'{len(checks)} account browser checks passed; no uncaught page errors.')

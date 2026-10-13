"""Capture clean documentation screenshots after e2e.py has generated its fixture backup."""
import json
from pathlib import Path
from playwright.sync_api import sync_playwright

root = Path(__file__).resolve().parents[1]
output = root / 'docs' / 'screenshots'
output.mkdir(exist_ok=True)
fixture = json.loads((root / 'test-results' / 'workspace-backup.json').read_text(encoding='utf-8'))

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    context = browser.new_context(viewport={'width': 1440, 'height': 1000})
    page = context.new_page()
    page.goto('http://127.0.0.1:5173/')
    page.wait_for_load_state('networkidle')
    page.screenshot(path=str(output / 'desktop.png'), full_page=True)
    # Use an isolated simulated task for the export screenshot, never a user's workspace.
    page.wait_for_timeout(600)
    page.evaluate('(data) => localStorage.setItem("game-eval-studio.workspace.v1", JSON.stringify(data))', {'schemaVersion': 1, 'projects': fixture['projects'][:1]})
    page.reload()
    page.wait_for_load_state('networkidle')
    page.set_viewport_size({'width': 375, 'height': 812})
    page.get_by_role('navigation', name='评测制作流程').get_by_role('button', name='版本与导出').click()
    page.locator('#main-content').focus()
    page.screenshot(path=str(output / 'mobile.png'), full_page=True)
    context.close()
    browser.close()
print('Documentation screenshots generated.')

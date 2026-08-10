import json

from playwright.sync_api import sync_playwright


URL = "http://127.0.0.1:1420/?preview=ready"
POSITION_KEY = "jarvis.gestureHudPosition.v1"


with sync_playwright() as playwright:
    browser = playwright.chromium.launch(headless=True)
    page = browser.new_page(viewport={"width": 1280, "height": 800})
    page.goto(URL)
    page.wait_for_load_state("networkidle")

    def run_command(command: str) -> None:
        page.locator("#command-input").fill(command)
        page.locator("#command-form").evaluate("form => form.requestSubmit()")
        page.wait_for_timeout(80)

    page.locator(".shell").evaluate("element => element.classList.add('controls-visible')")
    page.locator("#settings").click()
    assert page.locator("#settings-dialog").get_attribute("open") is not None
    page.locator("#gesture-help").click()
    guide = page.locator("#gesture-guide-dialog")
    assert guide.get_attribute("open") is not None
    assert guide.locator(".gesture-guide-card").count() == 9
    assert "360°" in guide.inner_text()
    assert "双手同时张开" in guide.inner_text()
    assert "双手同时握拳" in guide.inner_text()
    page.locator("#close-gesture-guide").click()
    assert guide.get_attribute("open") is None
    page.locator("#close-settings-top").click()

    run_command("界面语言切换为英文")
    assert page.locator(".shell").get_attribute("data-lang") == "en"
    run_command("音色设为 Cove")
    assert page.evaluate("localStorage.getItem('jarvis.voice')") == "cove"
    run_command("唤醒词改为 星期五")
    assert page.evaluate("localStorage.getItem('jarvis.wakePhrase')") == "星期五"
    run_command("工作目录设为 /Users/reson/Automation")
    assert page.evaluate("localStorage.getItem('jarvis.workspace')") == "/Users/reson/Automation"
    run_command("权限改为安全模式")
    assert page.evaluate("localStorage.getItem('jarvis.permissionMode')") == "safe"
    run_command("主题切换为矩阵")
    assert page.locator(".shell").get_attribute("data-theme") == "matrix"
    run_command("能量强度设为 88")
    studio_config = json.loads(page.evaluate("localStorage.getItem('jarvis.studio.v1')"))
    assert studio_config["intensity"] == 88
    run_command("隐藏协作面板")
    assert "hide-workers" in (page.locator(".shell").get_attribute("class") or "")
    run_command("显示所有设置")
    assert "Settings:" in page.locator("#assistant-transcript").inner_text()

    hud = page.locator("#gesture-hud")
    hud.evaluate("element => element.classList.remove('hidden')")
    page.wait_for_timeout(350)
    assert hud.locator("video").count() == 1
    assert hud.locator(".gesture-info").count() == 0
    before = hud.bounding_box()
    assert before is not None

    page.mouse.move(before["x"] + 30, before["y"] + 30)
    page.mouse.down()
    page.mouse.move(before["x"] + 170, before["y"] - 45, steps=8)
    page.mouse.up()

    after = hud.bounding_box()
    assert after is not None
    assert after["x"] > before["x"] + 100, (before, after)
    assert after["y"] < before["y"] - 50, (before, after)
    stored = page.evaluate("key => localStorage.getItem(key)", POSITION_KEY)
    assert stored is not None
    saved_position = json.loads(stored)
    assert saved_position["x"] >= 8 and saved_position["y"] >= 8

    page.reload()
    page.wait_for_load_state("networkidle")
    hud = page.locator("#gesture-hud")
    hud.evaluate("element => element.classList.remove('hidden')")
    page.wait_for_timeout(50)
    restored = hud.bounding_box()
    assert restored is not None
    assert abs(restored["x"] - after["x"]) < 2
    assert abs(restored["y"] - after["y"]) < 2

    page.keyboard.press("s")
    assert "spin-active" in (page.locator(".character-rig").get_attribute("class") or "")

    browser.close()

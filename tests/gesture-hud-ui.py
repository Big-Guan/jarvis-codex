import json

from playwright.sync_api import sync_playwright


URL = "http://127.0.0.1:1420/?preview=ready"
POSITION_KEY = "jarvis.gestureHudPosition.v1"


with sync_playwright() as playwright:
    browser = playwright.chromium.launch(headless=True)
    page = browser.new_page(viewport={"width": 1280, "height": 800})
    page.goto(URL)
    page.wait_for_load_state("networkidle")

    page.locator(".shell").evaluate("element => element.classList.add('controls-visible')")
    page.locator("#settings").click()
    assert page.locator("#settings-dialog").get_attribute("open") is not None
    page.locator("#gesture-help").click()
    guide = page.locator("#gesture-guide-dialog")
    assert guide.get_attribute("open") is not None
    assert guide.locator(".gesture-guide-card").count() == 6
    assert "360°" in guide.inner_text()
    page.locator("#close-gesture-guide").click()
    assert guide.get_attribute("open") is None
    page.locator("#close-settings-top").click()

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

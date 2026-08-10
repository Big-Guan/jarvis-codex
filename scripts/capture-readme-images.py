from pathlib import Path

from playwright.sync_api import sync_playwright


ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / "docs" / "images"
URL = "http://127.0.0.1:1420/?preview=working"


def save(page, name: str) -> None:
    page.screenshot(path=str(OUTPUT / name), full_page=True)


with sync_playwright() as playwright:
    browser = playwright.chromium.launch(headless=True)
    page = browser.new_page(
        viewport={"width": 1440, "height": 960},
        device_scale_factor=1,
        color_scheme="dark",
    )
    browser_errors: list[str] = []
    page.on("pageerror", lambda error: browser_errors.append(str(error)))
    page.on(
        "console",
        lambda message: browser_errors.append(message.text) if message.type == "error" else None,
    )
    page.goto(URL)
    page.wait_for_load_state("networkidle")
    page.add_style_tag(
        content="""
        html, body { background: radial-gradient(circle at 50% 42%, #082532 0%, #02080d 56%, #000 100%) !important; }
        .shell { background: radial-gradient(circle at 50% 42%, rgba(8,37,50,.42), rgba(0,0,0,.08) 58%) !important; }
        """
    )
    page.locator(".shell").evaluate("element => element.classList.add('controls-visible')")
    page.locator("#user-transcript").evaluate(
        "element => element.textContent = '“打开摄像头，切换矩阵主题，并显示任务状态”'"
    )
    page.locator("#assistant-transcript").evaluate(
        "element => element.textContent = '手势 v2 与自然语言设置控制已上线。'"
    )
    page.keyboard.press("d")
    page.wait_for_timeout(2200)
    save(page, "jarvis-main-v2.png")

    page.keyboard.press("d")
    page.locator("#settings").click()
    page.locator("#gesture-help").click()
    page.locator("#gesture-guide-dialog").wait_for(state="visible")
    assert page.locator("#gesture-guide-dialog .gesture-guide-card").count() == 9
    page.wait_for_timeout(250)
    save(page, "jarvis-gesture-v2.png")

    page.locator("#close-gesture-guide").click()
    settings = page.locator("#settings-dialog")
    settings.evaluate("element => element.scrollTop = element.scrollHeight")
    page.wait_for_timeout(200)
    save(page, "jarvis-settings-control.png")

    page.locator("#open-studio").click()
    page.locator("#studio-dialog").wait_for(state="visible")
    page.locator('[data-studio-theme="matrix"]').click()
    page.locator('[data-studio-layout="command"]').click()
    page.wait_for_timeout(300)
    save(page, "jarvis-diy-studio.png")

    browser.close()
    if browser_errors:
        raise RuntimeError("Browser errors while capturing README images:\n" + "\n".join(browser_errors))

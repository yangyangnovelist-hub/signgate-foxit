from pathlib import Path
from playwright.sync_api import sync_playwright


BASE_URL = "http://127.0.0.1:8787"
RUNTIME = Path(__file__).resolve().parents[1] / "runtime"
ASSETS = Path(__file__).resolve().parents[1] / "assets"


def prepare_and_approve(page):
    page.goto(BASE_URL)
    page.wait_for_load_state("networkidle")
    page.get_by_role("button", name="Prepare exact artifact").click()
    page.wait_for_selector("#paper:not([hidden])", timeout=30_000)
    phrase = page.locator("#required-phrase").inner_text()
    assert phrase.startswith("APPROVE ")
    page.locator("#approval-phrase").fill(phrase)
    page.locator("#attest-recipient").check()
    page.locator("#attest-authority").check()
    page.get_by_role("button", name="Issue one-shot approval").click()
    page.locator("#send-button:enabled").wait_for(timeout=10_000)


def main():
    RUNTIME.mkdir(parents=True, exist_ok=True)
    ASSETS.mkdir(parents=True, exist_ok=True)
    console_errors = []
    with sync_playwright() as p:
        browser = p.chromium.launch(channel="chrome", headless=True)
        context = browser.new_context(viewport={"width": 1440, "height": 1050}, device_scale_factor=1)
        page = context.new_page()
        page.on("console", lambda message: console_errors.append(message.text) if message.type == "error" else None)
        page.on("pageerror", lambda error: console_errors.append(str(error)))

        prepare_and_approve(page)
        assert "Mutual" in page.locator("#doc-title").inner_text()
        assert len(page.locator("#artifact-hash").inner_text()) == 64
        assert "HTML PROOF / DEMO" in page.locator("#artifact-mode").inner_text()
        page.get_by_role("button", name="Dispatch approved artifact").click()
        page.wait_for_function("() => document.querySelector('#event-log')?.innerText.includes('sent no email')")
        assert page.locator("#send-button").is_disabled()
        page.locator(".workspace").screenshot(path=str(ASSETS / "signgate-workspace.png"))
        page.screenshot(path=str(RUNTIME / "e2e-desktop.png"), full_page=True)

        prepare_and_approve(page)
        page.get_by_role("button", name="Change recipient, then try ↯").click()
        page.wait_for_function("() => document.querySelector('#event-log')?.innerText.includes('EXPECTED HARD BLOCK')")
        assert "APPROVAL_BINDING_BROKEN" in page.locator("#event-log").inner_text()
        assert "ZERO PROVIDER CALLS" in page.locator("#gate-result").inner_text()
        page.locator(".workspace").screenshot(path=str(ASSETS / "signgate-tamper-proof.png"))
        assert page.locator("#audit-valid").inner_text() == "HASH CHAIN VALID"

        overflow = page.evaluate("document.documentElement.scrollWidth - document.documentElement.clientWidth")
        assert overflow <= 1, f"desktop horizontal overflow: {overflow}px"

        mobile = browser.new_context(viewport={"width": 390, "height": 844}, device_scale_factor=1)
        mobile_page = mobile.new_page()
        mobile_page.goto(BASE_URL)
        mobile_page.wait_for_load_state("networkidle")
        mobile_overflow = mobile_page.evaluate("document.documentElement.scrollWidth - document.documentElement.clientWidth")
        assert mobile_overflow <= 1, f"mobile horizontal overflow: {mobile_overflow}px"
        mobile_page.screenshot(path=str(RUNTIME / "e2e-mobile.png"), full_page=True)
        mobile_page.screenshot(path=str(ASSETS / "signgate-mobile.png"), full_page=False)

        mobile.close()
        context.close()
        browser.close()

    unexpected_errors = [message for message in console_errors if "409 (Conflict)" not in message]
    assert not unexpected_errors, f"browser console errors: {unexpected_errors}"
    print("E2E PASS: prepare → approve → transparent simulation")
    print("E2E PASS: post-approval recipient mutation → hard block")
    print("E2E PASS: desktop/mobile layouts have no horizontal overflow")
    print(f"Screenshots: {RUNTIME / 'e2e-desktop.png'}, {RUNTIME / 'e2e-mobile.png'}")


if __name__ == "__main__":
    main()

"""Run against a local UI origin. Requires Python Playwright and Chromium.

First assert the real response policy, then strip ONLY framing headers to
exercise client defense independently: CSP otherwise blocks the document before
its error page can run. No app/API requests may follow the bootstrap check.
"""
import sys
from urllib.request import urlopen
from playwright.sync_api import sync_playwright

origin = sys.argv[1].rstrip('/')
with urlopen(origin + '/') as response:
    assert "frame-ancestors 'self'" in response.headers['Content-Security-Policy']
    assert response.headers['X-Frame-Options'] == 'DENY'
with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    page = browser.new_page()
    seen = []
    page.on('request', lambda request: seen.append(request.url))
    def app_response(route):
        response = route.fetch()
        headers = {key: value for key, value in response.headers.items()
                   if key.lower() not in ('content-security-policy', 'x-frame-options')}
        route.fulfill(response=response, headers=headers)
    page.route(origin + '/**', app_response)
    page.route('http://disallowed.invalid/', lambda route: route.fulfill(
        content_type='text/html', body=f'<iframe name="embed" src="{origin}/"></iframe>'))
    page.goto('http://disallowed.invalid/')
    frame = page.frame_locator('iframe')
    frame.get_by_role('heading', name='This app is not supported inside a frame').wait_for()
    assert not any('/api/' in url or '/src/main' in url for url in seen), seen
    browser.close()
print('2 frame browser checks passed: real headers; denied frame has error and no app/API loads')

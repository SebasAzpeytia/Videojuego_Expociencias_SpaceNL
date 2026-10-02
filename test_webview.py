import webview
try:
    webview.create_window('Test', 'https://google.com')
    webview.start(gui='qt')
    print("Success qt")
except Exception as e:
    print(f"Error qt: {e}")

#!/usr/bin/env python3
"""
零依赖本地静态服务器 —— 给 Tibetan_Test_Suite.html 用。

为什么需要它（而不是"双击打开 HTML"）：
  页面要 fetch tibetan_data.json（规则表）与 ui_texts.json（界面文案）。
  浏览器对 file:// 下的 fetch 一律按 CORS 拦截，所以必须经由 HTTP 提供这些文件，
  否则页面会提示加载数据失败。

用法：
    python start_server.py                  # 默认 8000 端口
    python start_server.py 8080             # 指定端口
    python start_server.py --open           # 顺便打开浏览器
    python start_server.py --host 0.0.0.0   # 允许局域网访问（默认只绑 127.0.0.1）
"""
import http.server
import os
import socketserver
import sys
import threading
import webbrowser

DEFAULT_PORT = 8000


class Handler(http.server.SimpleHTTPRequestHandler):
    """在默认行为上加两件事：禁缓存（改完文件刷新即见）、静音 200 日志。"""

    def end_headers(self):
        # 开发用途：别让浏览器缓存住 json/js/字体，否则改了规则表还看到旧结果
        self.send_header("Cache-Control", "no-store, no-cache, must-revalidate, max-age=0")
        self.send_header("Pragma", "no-cache")
        self.send_header("Expires", "0")
        super().end_headers()

    def log_message(self, fmt, *args):
        # 只记 4xx/5xx；把满屏 200 静音掉（Windows 上尤其刷屏）
        status = str(args[1]) if len(args) > 1 else ""
        if status[:1] in ("4", "5"):
            super().log_message(fmt, *args)

    def guess_type(self, path):
        base, ext = os.path.splitext(path)
        if ext == ".wasm":
            return "application/wasm"
        if ext == ".woff2":
            return "font/woff2"
        return super().guess_type(path)


def main():
    args = sys.argv[1:]
    port = DEFAULT_PORT
    host = "127.0.0.1"
    open_browser = False

    i = 0
    while i < len(args):
        a = args[i]
        if a == "--open":
            open_browser = True
        elif a == "--host" and i + 1 < len(args):
            i += 1
            host = args[i]
        elif a.isdigit():
            port = int(a)
        elif a in ("-h", "--help"):
            print(__doc__)
            return 0
        else:
            print(f"未知参数：{a}\n")
            print(__doc__)
            return 2
        i += 1

    # 从脚本所在目录提供服务，这样从任何目录调用都能跑
    root = os.path.dirname(os.path.abspath(__file__))
    os.chdir(root)

    if not os.path.exists("Tibetan_Test_Suite.html"):
        print("找不到 Tibetan_Test_Suite.html。")
        print(f"当前服务目录：{root}")
        print("请把本脚本与页面放在同一目录（即仓库根）。")
        return 1

    socketserver.TCPServer.allow_reuse_address = True
    try:
        httpd = socketserver.TCPServer((host, port), Handler)
    except OSError as e:
        hint = ""
        if getattr(e, "errno", None) in (48, 98, 10048):  # EADDRINUSE（各平台取值不同）
            hint = f"\n端口 {port} 已被占用。换一个：python start_server.py {port + 1}"
        print(f"启动失败：{e}{hint}")
        return 1

    shown_host = "localhost" if host in ("127.0.0.1", "localhost") else host
    url = f"http://{shown_host}:{port}/Tibetan_Test_Suite.html"

    print("=" * 64)
    print("  Byro Tibetan Syllable Guardian —— 本地测试套件")
    print("=" * 64)
    print(f"  服务目录: {root}")
    print(f"  访问地址: {url}")
    print(f"  绑定    : {host}:{port}" + ("（仅本机）" if host == "127.0.0.1" else "（局域网可访问）"))
    print("  停止    : Ctrl+C")
    print("=" * 64)

    if not open_browser:
        print("  （加 --open 可自动打开浏览器）")

    if open_browser:
        threading.Timer(0.6, lambda: webbrowser.open(url)).start()

    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\n服务器已停止")
    finally:
        httpd.server_close()
    return 0


if __name__ == "__main__":
    sys.exit(main())

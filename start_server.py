#!/usr/bin/env python3
"""
本地服务器启动脚本
用于启动HTTP服务器，方便测试藏文文本校准系统
"""

import http.server
import socketserver
import os
import sys

# 服务器配置
PORT = 8000
DIRECTORY = os.path.dirname(os.path.abspath(__file__))

class CustomHTTPRequestHandler(http.server.SimpleHTTPRequestHandler):
    """自定义HTTP请求处理器"""
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=DIRECTORY, **kwargs)

    def end_headers(self):
        # 禁止缓存 JS/JSON，避免开发过程中浏览器缓存旧版本脚本导致逻辑不一致
        self.send_header('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0')
        self.send_header('Pragma', 'no-cache')
        self.send_header('Expires', '0')
        super().end_headers()

def start_server():
    """启动HTTP服务器"""
    print(f"启动本地服务器...")
    print(f"服务器目录: {DIRECTORY}")
    print(f"访问地址: http://localhost:{PORT}")
    print("按 Ctrl+C 停止服务器")
    print("-" * 50)
    
    try:
        # 创建服务器
        with socketserver.TCPServer(("", PORT), CustomHTTPRequestHandler) as httpd:
            # 启动服务器
            httpd.serve_forever()
    except KeyboardInterrupt:
        print("\n服务器已停止")
    except Exception as e:
        print(f"启动服务器时出错: {e}")
        sys.exit(1)

if __name__ == "__main__":
    start_server()
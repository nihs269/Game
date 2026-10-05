"""Game Hub — chạy: python main.py [--port 8080]"""
import argparse
import os

from core.server import run

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Game Hub - chơi game cùng bạn bè qua mạng")
    parser.add_argument("--host", default="0.0.0.0", help="Địa chỉ lắng nghe (mặc định 0.0.0.0)")
    parser.add_argument("--port", type=int, default=int(os.environ.get("PORT", 8080)), help="Cổng (mặc định 8080)")
    parser.add_argument("--https-port", type=int, default=None, help="Cổng HTTPS cho mic (mặc định: cổng + 1)")
    parser.add_argument("--https", action="store_true", help="Mở thêm cổng HTTPS dùng cho mic (voice chat đang tạm tắt)")
    args = parser.parse_args()
    run(args.host, args.port, https=args.https, https_port=args.https_port)

"""Tự tạo chứng chỉ HTTPS (tự ký) để trình duyệt cho phép dùng mic qua mạng LAN."""
import datetime
import ipaddress
import json
import os


def ensure_cert(folder, ips):
    """Trả về (cert_file, key_file); tạo mới nếu chưa có hoặc địa chỉ IP thay đổi."""
    os.makedirs(folder, exist_ok=True)
    cert_file = os.path.join(folder, "cert.pem")
    key_file = os.path.join(folder, "key.pem")
    meta_file = os.path.join(folder, "hosts.json")
    hosts = sorted(set(ips) | {"127.0.0.1"})
    try:
        with open(meta_file, encoding="utf-8") as f:
            if json.load(f) == hosts and os.path.exists(cert_file) and os.path.exists(key_file):
                return cert_file, key_file
    except (OSError, ValueError):
        pass

    from cryptography import x509
    from cryptography.hazmat.backends import default_backend
    from cryptography.hazmat.primitives import hashes, serialization
    from cryptography.hazmat.primitives.asymmetric import rsa
    from cryptography.x509.oid import NameOID

    key = rsa.generate_private_key(public_exponent=65537, key_size=2048, backend=default_backend())
    name = x509.Name([x509.NameAttribute(NameOID.COMMON_NAME, "Game Hub (local)")])
    san = [x509.DNSName("localhost")] + [x509.IPAddress(ipaddress.ip_address(ip)) for ip in hosts]
    now = datetime.datetime.utcnow()
    cert = (
        x509.CertificateBuilder()
        .subject_name(name)
        .issuer_name(name)
        .public_key(key.public_key())
        .serial_number(x509.random_serial_number())
        .not_valid_before(now - datetime.timedelta(days=1))
        .not_valid_after(now + datetime.timedelta(days=3650))
        .add_extension(x509.SubjectAlternativeName(san), critical=False)
        .add_extension(x509.BasicConstraints(ca=True, path_length=None), critical=True)
        .sign(key, hashes.SHA256(), default_backend())
    )
    with open(key_file, "wb") as f:
        f.write(key.private_bytes(serialization.Encoding.PEM, serialization.PrivateFormat.TraditionalOpenSSL,
                                  serialization.NoEncryption()))
    with open(cert_file, "wb") as f:
        f.write(cert.public_bytes(serialization.Encoding.PEM))
    with open(meta_file, "w", encoding="utf-8") as f:
        json.dump(hosts, f)
    return cert_file, key_file

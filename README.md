# CrypNote

CrypNote is a simple system for encrypting and digitally signing data to send to people. It is
useful for secure communication over an insecure channel, such as company-monitored e-mail or chat.
Messages are encrypted using AES-256-GCM, establishing a shared secret via P-256 ECDH. Signing
happens using P-256 ECDSA.

CrypNote is distributed as a single HTML file which can be used from most modern browsers. You can
install it by downloading `CrypNote.html` from the
[releases page](https://github.com/SabrinaJewson/CrypNote/releases). When updating your version of
CrypNote, make sure that it has the same file path as the old version, otherwise all your data will
not be transferred over.

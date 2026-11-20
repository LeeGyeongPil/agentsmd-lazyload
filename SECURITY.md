# 보안 정책 / Security policy

보안 취약점을 발견하셨다면 **공개 이슈 대신** 이 레포의 **Security → Report a vulnerability**(비공개 취약점 신고)로 알려 주세요. 확인 후 답변드리고, 고친 버전을 릴리스하면서 함께 안내합니다.

If you find a security issue, please **do not open a public issue**. Use **Security → Report a vulnerability** in this repository to report it privately. We will reply after checking and announce the fix with a release.

이 도구는 Codex 훅으로 내 컴퓨터에서만 실행되며 네트워크 호출을 하지 않습니다. 지침 파일과 `config.toml` 을 읽고, 세션마다 작은 상태 파일만 씁니다. / It runs locally as a Codex hook and makes no network calls. It reads instruction files and `config.toml`, and writes only one small state file per session.

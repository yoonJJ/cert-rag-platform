---
name: pr
description: 현재 변경 사항을 브랜치로 커밋·push 하고 GitHub PR을 만든 뒤 리뷰어(jinho-yoo-jack)를 지정합니다. 사용자가 /pr 로 직접 호출할 때만 실행합니다.
argument-hint: "[브랜치 이름 또는 작업 요약 (선택)]"
disable-model-invocation: true
---

# /pr — 브랜치 → 한글 커밋 → push → PR → 리뷰어 지정

저장소: `yoonJJ/cert-rag-platform`, 기본 브랜치 `main`, 리뷰어 `jinho-yoo-jack`.
인자: `$ARGUMENTS` (비어 있으면 변경 내용으로 브랜치 이름·제목을 정함)

## 1. 상태 확인
- `git status --short`, `git branch --show-current`, `git fetch origin main -q`, `git log --oneline origin/main..HEAD`
- 커밋할 변경도 없고 `origin/main`보다 앞선 커밋도 없으면 "올릴 변경이 없습니다"라고 알리고 끝냅니다.
- `git`이 Xcode 라이선스로 막히면 사용자에게 `sudo xcodebuild -license accept` 실행을 안내하고 멈춥니다.

## 2. 비밀값 검사 (실패 시 중단)
- 올라갈 파일 목록(`git status --short` + 앞선 커밋의 파일)에 `.env`, `.env.*`(단 `*.example` 제외), `.venv/`, 키 파일이 있으면 중단하고 알립니다.
- `git diff HEAD` 와 `git diff origin/main...HEAD` 에서 키처럼 보이는 문자열을 찾습니다:
  `AIza[0-9A-Za-z_-]{20,}`, `sk-[A-Za-z0-9_-]{20,}`, `sk-ant-[A-Za-z0-9_-]{20,}`, `ghp_[A-Za-z0-9]{20,}`
  발견되면 **값은 출력하지 말고** 파일과 줄 번호만 알려 주고 중단합니다.

## 3. 브랜치
- 현재 브랜치가 `main`이 아니면 그 브랜치를 그대로 씁니다.
- `main`이면 `feature/<영문-kebab-요약>` 브랜치를 만듭니다(`$ARGUMENTS`가 브랜치 이름 형태면 그대로 사용). 작업 트리 변경은 그대로 따라옵니다.
- `main`에 아직 push 안 된 커밋이 있으면(`origin/main..HEAD`가 비어 있지 않음): 새 브랜치가 그 커밋들을 가져가고, 로컬 `main`을 `origin/main`으로 되돌려야 합니다. 이건 되돌리기 어려운 작업이므로 **커밋 목록을 보여 주고 사용자 확인을 받은 뒤** `git branch -f main origin/main` 으로 처리합니다(작업 트리는 건드리지 않음).

## 4. 검증 (실패 시 커밋하지 않고 출력과 함께 보고)
- `server-py/` 변경이 있으면: `cd server-py && .venv/bin/pytest -q`
- `client/` 변경이 있으면: `cd client && npx vite build --outDir <스크래치 폴더>` (`dist/`를 쓰지 않음)
- 해당 없으면 건너뛰고, 건너뛴 사실을 보고에 적습니다.

## 5. 커밋
- 커밋할 변경이 있을 때만: `git add -A` 후 커밋.
- 메시지는 **한글**: 첫 줄 50자 안팎 요약, 빈 줄, `- ` 목록으로 주요 변경 2~6개. 마지막에 세션이 지정한 attribution 줄을 붙입니다.
- 여러 줄 메시지는 heredoc 으로 전달합니다.

## 6. push 와 PR
- `git push -u origin <브랜치>`
- 이미 이 브랜치의 PR이 있으면(`gh pr view --json url`) 새로 만들지 않고 그 PR을 갱신된 것으로 보고합니다.
- 없으면 `gh pr create --base main --head <브랜치> --title "<한글 제목>" --body-file <임시 파일>`
  본문 형식:
  ```
  ## 요약
  <무엇을 왜 바꿨는지 2~3줄>

  ## 변경 사항
  - ...

  ## 확인한 것
  - pytest / 빌드 결과, 직접 확인한 화면 등 (안 한 것은 "안 함"으로 명시)

  ## 리뷰 포인트
  - 리뷰어가 특히 봐 줬으면 하는 부분

  <세션이 지정한 PR attribution 줄>
  ```

## 7. 리뷰어 지정
- `gh pr edit <번호> --add-reviewer jinho-yoo-jack`
- 실패하면 `gh api repos/yoonJJ/cert-rag-platform/invitations --jq '.[].invitee.login'` 로 초대가 아직 수락 전인지 확인해,
  "초대 수락 후 `gh pr edit <번호> --add-reviewer jinho-yoo-jack` 를 다시 실행하면 됩니다"라고 안내합니다. PR 생성 자체는 성공으로 봅니다.

## 8. 보고 (한국어, 짧게)
- PR 링크, 브랜치 이름, 커밋 메시지 첫 줄, 검증 결과, 리뷰어 지정 여부.

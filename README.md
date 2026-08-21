# 오목 AI Arena

15×15 기본 오목과 9×9 랜덤 스코어 변형에서 사람·예제 AI v1~v5·사용자 JavaScript AI를 대국시키고 성능을 비교하는 AI 연구실입니다.

## GitHub Pages

공개 Arena: **https://proudius.github.io/gomoku-ai-prototype/**

`main` 브랜치에 변경 사항을 올리면 `.github/workflows/pages.yml`이 정적 Arena를 빌드해 GitHub Pages에 자동 배포합니다.

## 가장 빠른 실행

Windows 탐색기에서 **`오목 AI Arena 실행.cmd`**를 더블클릭하세요.

- 필요한 패키지가 없으면 첫 실행에만 자동으로 준비합니다.
- 준비가 끝나면 브라우저에서 `http://localhost:3000/`을 자동으로 엽니다.
- 함께 열린 명령 창을 닫으면 Arena 서버가 종료됩니다.

Node.js 22.13 이상이 필요합니다.

## 명령어로 실행

```powershell
cd D:\codex_prj\gomoku-ai-prototype
npm install
npm run arena
```

## 주요 기능

- 사람·v1~v5·내 AI 코드의 자유로운 흑/백 선수 조합
- `chooseMove(state, me)` JavaScript AI 편집기와 500ms Worker 실행 제한
- 예제 AI별 흑/백 교대 벤치마크, 승·무·패·오류 집계
- 추천 수, 탐색 노드·깊이·시간 계측, 대국 기보
- AI 자동 대국과 단계별 알고리즘 설명
- 9×9 랜덤 스코어 변형: 장애물·흑돌·백돌 각 8칸 선배치, 빈칸 소진 또는 추가 득점 불가 시 연속 5칸 구간 수로 승부

## 검증

```powershell
npm run lint
npm run build
npm run build:pages
```

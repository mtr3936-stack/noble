---
name: board-builder
description: 혁신노블부동산 정적 게시판 홈페이지(GitHub 저장소 + Vercel 서버리스)를 구축·유지보수하고, 마크다운 게시글을 data/posts.json에 추가하는 절차.
---

# board-builder

GitHub 저장소의 `data/posts.json`을 데이터베이스로 쓰고, Vercel에 정적 페이지와 서버리스 함수로 배포하는 부동산 게시판 홈페이지입니다.

## 구조

| 경로 | 역할 |
| --- | --- |
| `index.html` | 메인(추천매물, 대표 소개, 최신 소식 3개 미리보기 `#board-preview`) |
| `news.html` | 게시글 목록, 카테고리 탭, 검색 `#search-input`, 목록 `#news-list`, 데스크탑 사이드바 |
| `news-detail.html` | 게시글 상세(`renderMarkdown`), 관리자일 때만 수정·삭제 |
| `news-write.html` | 글쓰기·수정(관리자 전용, `requireAdmin()`) |
| `admin.html` | 관리자 로그인 + 게시글 관리 대시보드 |
| `property-admin.html` | 추천 매물 관리 센터(노출 토글, 거래완료 보관함, 순서 변경, 빠른 편집기, 신규 등록) |
| `db.js` | 설정 로드, 게시글 CRUD, 로그인 세션, 마크다운 렌더러 |
| `api/config.js` | 연동 상태만 반환(`api`, `github_ready`, `admin_ready`). 비밀값은 절대 반환하지 않음 |
| `api/login.js` | `ADMIN_PASSWORD` 검증 후 12시간짜리 HMAC 세션 토큰 발급 |
| `api/posts.js` | GET은 공개, POST/PUT/DELETE는 세션 토큰 필요. 서버에서 `GITHUB_TOKEN`으로 GitHub Contents API 호출 |
| `api/properties.js` | GET은 공개, PUT은 세션 토큰 필요. `data/properties.json` 전체 목록을 검증 후 저장(진행 매물 최대 12건) |
| `config/git_config.json` | `github_owner`, `github_repo`, `data_file_path` (토큰은 항상 `YOUR_GITHUB_TOKEN`) |
| `data/posts.json` | 게시글 배열 |
| `data/properties.json` | 추천 매물 배열. 배열 순서 = 메인 노출 순서. `status: "sold"`는 보관함, `visible: false`는 숨김 |
| `templates/post-template.md` | 글 작성용 마크다운 템플릿 |
| `vercel.json` | `cleanUrls`, `trailingSlash`만 사용하는 zero-config |

## 규칙

- `public/` 폴더를 만들지 않는다. Vercel이 사이트 루트로 인식해 루트 HTML이 404가 된다.
- `vercel.json`에 `builds`, `routes`, `version`을 넣지 않는다. `/api` 폴더는 자동으로 함수로 배포된다.
- GitHub 토큰과 관리자 비밀번호는 Vercel 환경 변수(`GITHUB_TOKEN`, `ADMIN_PASSWORD`)에만 둔다. 파일이나 프론트엔드 응답에 넣지 않는다.
- 토큰은 서버에서 `replace(/\s+/g, "")`로 공백·줄바꿈을 제거한 뒤 헤더에 넣는다.
- 본문은 마크다운으로 저장하고, 상세는 `renderMarkdown`, 목록·미리보기 요약은 `markdownToText(...).slice(0, N)`을 사용한다.
- `renderMarkdown`은 입력을 먼저 HTML-escape하고, 링크는 `http/https/mailto`만 허용하며, 코드 스팬은 백틱 기준 분할로 처리한다.
- 내부 링크는 `admin.html`처럼 `.html`을 붙여도 된다(cleanUrls가 정규화). `db.js`, `agent.jpg`, `config/git_config.json`, `data/posts.json`, `/api/*` 같은 리소스 경로는 그대로 둔다.

## 추천 매물 스키마

```json
{
  "id": "CHUNG-2026-001",
  "name": "대방노블랜드 더캐슬 [105동]",
  "category": "apt | commercial | presale | land",
  "trade": "trade | jeonse | monthly",
  "price": "매매가·전세가·보증금",
  "monthly": "월세(월세만)",
  "area": "전용 84.9㎡ (34평형)",
  "floor": "18층 / 남향",
  "tags": ["초품아", "올확장"],
  "description": "한 줄 설명",
  "visible": true,
  "status": "active | sold",
  "updated_at": "YYYY-MM-DD"
}
```

매물명에서 `[ ]`로 감싼 부분은 메인 화면에서 파란색으로 강조된다.

## 게시글 스키마

```json
{
  "id": "1792500000000",
  "title": "제목",
  "category": "공지사항 | 진주혁신도시 | 부동산정책 | 시장동향 | 단지소식",
  "author": "조우정 대표",
  "date": "YYYY-MM-DD",
  "thumbnail": "선택: https:// 주소 또는 사이트 내 경로",
  "content": "마크다운 본문",
  "updated_at": "ISO 시각(서버가 기록)"
}
```

## 사용자가 마크다운 글을 건네줄 때

1. `templates/post-template.md` 형식의 프론트매터에서 `title`, `category`, `date`를 읽는다.
2. 프론트매터 아래 본문만 `content`에 넣는다.
3. 배포된 사이트의 `admin.html`에서 로그인 후 글쓰기 화면으로 올리거나, `data/posts.json` 배열 맨 앞에 추가하고 커밋·푸시한다.

## 로컬 실행

```bash
npx http-server -c-1 -p 8080
```

로컬에는 `/api`가 없으므로 미리보기 모드로 동작한다. 관리자 비밀번호는 `admin1234`이고, 글은 브라우저 localStorage에만 저장된다.

## Vercel 환경 변수

| 이름 | 필수 | 설명 |
| --- | --- | --- |
| `GITHUB_TOKEN` | 예 | `repo` 권한 개인 액세스 토큰 |
| `ADMIN_PASSWORD` | 예 | 관리자 로그인 비밀번호 |
| `SESSION_SECRET` | 권장 | 세션 토큰 서명용 임의 문자열 |
| `GITHUB_OWNER`, `GITHUB_REPO`, `DATA_FILE_PATH`, `GITHUB_BRANCH` | 아니오 | 기본값: Vercel Git 연동 정보, `data/posts.json` |

# 안전한 빌드와 검증 산출물

웹과 데스크톱 빌드는 검증한 HTML·Vite 설정·화면 소스·정적 파일·Three.js를 새 임시 디렉터리로 복사하고 전용 출력 폴더에서 빌드합니다. 입력과 출력의 심볼릭 링크·정션·특수 파일을 거부합니다. 웹 번들과 설치 파일은 완성된 디렉터리 단위로 교체합니다.

브라우저·데스크톱 테스트도 새 임시 디렉터리에 기록한 다음 종료 시 기존 `output/` 경로로 결과를 게시합니다. 개발 서버는 검증 자료와 스테이징 폴더를 제공하지 않습니다. POSIX에서는 다른 사용자가 쓸 수 있는 산출물 부모 폴더도 거부합니다. Windows에서는 쓰기 권한을 관리하는 전용 계정의 작업 폴더나 격리된 CI 러너에서 실행하세요.

CI는 `npm ci --ignore-scripts`로 잠금 파일의 의존성을 설치한 뒤, Playwright Chromium과 데스크톱 빌드의 Electron 준비 단계만 명시적으로 실행합니다. 소스와 잠금 파일을 검토한 뒤 빌드하세요. Electron·Chromium·NSIS의 바이너리 준비는 각 도구의 공급 경로에 의존합니다.

## Windows 정식 배포

`npm run package:desktop`은 개발·검증용 패키징입니다. Playwright의 메인 프로세스 제어가 필요한 독립 앱 검사는 `npm run package:desktop-test`로 만든 별도 패키지에서 실행합니다. 배포용 실행 파일은 Node 실행 모드·Node 환경 옵션·메인 프로세스 디버거를 끄고 내장 ASAR 무결성 검사를 사용합니다.

정식 배포는 신뢰할 수 있는 Windows 릴리스 환경에서 `npm run package:release`를 실행합니다. electron-builder가 사용할 Authenticode 게시자 자격 증명과 타임스탬프 서비스를 준비하고, `TRANSMISSION_SIGNER_SHA256`에 별도 경로에서 확인한 게시자 인증서의 SHA-256 지문(16진수 64자)을 설정합니다. 빌드는 설치 파일과 독립 실행 파일의 Authenticode 유효 상태, 타임스탬프, 게시자 인증서 지문을 확인한 뒤 `release/windows/`에 산출물을 기록합니다. 서명 작업은 PR 검증에 연결하지 않습니다.

받은 설치 파일은 Windows의 디지털 서명 정보에서 게시자를 확인합니다. 동명 SHA-256은 파일의 일치 여부를 확인하는 데 사용합니다.

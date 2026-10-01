# 외부 소프트웨어 고지

Transmission Lab의 3D 형상, 재질 텍스처와 아이콘은 앱 코드 또는 자체 제작 과정에서 생성합니다. 공식 제조사의 사진·로고·원본 CAD·폰트·HDR 파일을 배포하지 않습니다. 공식 절개 사진은 외형 참고 자료이며 원본과 사용 약관을 [참조 문서](cutaway-reference.md)에 연결합니다.

## 배포 앱에 포함하는 구성요소

**Three.js 0.180.0**과 예제 모듈을 사용합니다. MIT 고지 전문은 소스의 `public/THREE-LICENSE.txt`, 웹 빌드의 `THREE-LICENSE.txt`, Windows 설치 폴더의 `resources/THREE-LICENSE.txt`에 있습니다. 재배포할 때 해당 고지를 유지합니다. [Three.js r180 원본 라이선스](https://github.com/mrdoob/three.js/blob/r180/LICENSE)

Windows 설치 앱은 **Electron 44.5.1**과 그 안의 Chromium·Node.js 및 관련 구성요소를 포함합니다. Electron의 고지는 설치 폴더의 `LICENSE.electron.txt`, Chromium과 포함 구성요소의 고지는 `LICENSES.chromium.html`에 있습니다. 이 파일을 앱과 함께 유지합니다. [Electron 원본 라이선스](https://github.com/electron/electron/blob/v44.5.1/LICENSE)

1.2.0 독립 실행 배포본에서 위 세 고지 파일의 존재를 확인했습니다. 1.3.0은 최종 패키징 후 다시 확인하고 [제품 평가 기록](consumer-release.md)에 결과를 기록합니다. 이 문서가 1.3.0의 패키징 완료를 의미하지는 않습니다.

## 개발·검증 도구

Vite, Playwright와 electron-builder는 개발·빌드·검증 도구입니다. 앱 설치 프로그램은 해당 개발 실행 패키지를 포함하지 않습니다. 도구와 앱 의존성의 버전은 `package-lock.json`에 고정합니다. 공개 CI는 lockfile을 바꾸지 않는 `npm ci`를 사용합니다.

## 앱 자체의 권리

앱 소스의 기존 `UNLICENSED` 상태를 유지합니다. 이 문서는 외부 구성요소에 대한 고지이며 앱 전체에 새 오픈소스 라이선스나 판매 계약을 부여하지 않습니다. 소스 공개·체험 제공과 앱의 판매 조건·재배포 허락은 구분합니다.

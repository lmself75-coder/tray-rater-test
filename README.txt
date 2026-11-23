Tray Rater 외부 테스트용 정적 사이트
- 이 폴더 전체를 정적 웹 호스팅(사내 웹서버, GitHub Pages, Netlify 등)에 올리면 됩니다.
- 계산 코드와 데이터(bundle.enc.json)는 비밀번호로 암호화되어 있습니다.
- 비밀번호 변경: python -m tray_rater.build_static 을 다시 실행해 새로 만든 폴더를 다시 올리세요.
- 로컬 확인: python -m http.server 8766 --directory <이 폴더>

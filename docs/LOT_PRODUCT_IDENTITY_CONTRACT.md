# VisionQC AI — LOT·제품 번호 식별 및 정보 변경 이력

- IndexedDB v3→v4는 `lotRegistry`, `productRegistry`, `inspectionIdentity`, `identityAudit` 스토어를 **추가**한다. 기존 원본·검사·히트맵·검사 대기열·작업자 이력은 보존한다.
- LOT `key`와 제품 `key`는 바뀌지 않는 내부 ID. 작업자가 입력하는 LOT/제품 번호는 수정 가능하며 수정 시 `expectedRevision`, 작업자 식별명, 변경 사유를 필수로 요구한다.
- 동일 출처 LOT 번호 중복과 동일 LOT 내 제품 번호 중복을 IndexedDB 고유 인덱스로 거부한다. `user`와 `demo`는 분리한다.
- 브라우저 서비스 API: `registerLot`, `changeLot`, `listLots`, `getLot`, `registerProduct`, `changeProduct`, `listProducts`, `getProduct`, `assignInspection`, `getInspectionIdentity`, `identityHistory`, `lotOverview`.
- 검사에 제품을 지정/정정/해제하면 현재 연결을 `inspectionIdentity`에 별도 보관하고, 모든 변경을 `identityAudit`에 추가한다. **AI 검사 원본의 `lotId/productId`는 덮어쓰지 않는다.**
- 등록 예: `registerLot({lotId:'LOT-001',plannedQuantity:100,sourceType:'user',operatorName:'작업자',reason:'신규 등록'})`.
- 제품 예: `registerProduct({lotKey:lot.key,productId:'NUT-001',operatorName:'작업자',reason:'번호 확인'})`.
- 연결 예: `assignInspection({inspectionId:'scan-id',productKey:product.key,expectedRevision:0,operatorName:'작업자',reason:'사진과 제품 수동 연결'})`. 연결 해제는 `productKey:null`과 최신 revision을 전달한다.
- 경합 시 `identity_revision_conflict` 오류. 화면에서 최신 정보를 재조회한다. **정보가 바뀌지 않았다면 이력 이벤트를 추가하지 않는다.**
- `plannedQuantity:null`은 미입력, 0은 사용자가 기입한 0이다. 등록된 제품 코드 수는 실제 생산수량이나 인증된 고유 물리 제품 수가 아니다. **고유 제품 불량률과 실제 생산량은 계산하지 않는다.**
- 사용자가 검사 삭제를 명시 요청하면 검사에 부착된 연결 및 식별 감사 이력만 동일 트랜잭션에서 삭제한다. LOT/제품 마스터 데이터는 보존한다.
- 입력한 작업자 표시명은 인증된 사용자 계정이 아니다. 실제 제조 현장 인증·LOT 마감/재개방·보고서·실제품 식별 확인은 아직 미구현.
- Antigravity는 등록·수정·연결 UX를 구현하며 기존 `get(id).inspection.lotId`와 현재 제품 식별 연결이 다른 경우 현재 연결을 별도 조회해 표시한다. 실제 Windows Chrome 통합 검증은 별도.

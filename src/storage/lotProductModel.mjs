/** Operator-entered identifiers are not verified physical product identities. */
export const LOT_STORE='lotRegistry', PRODUCT_STORE='productRegistry', LINK_STORE='inspectionIdentity', AUDIT_STORE='identityAudit';
export function code(value) {
  if(typeof value!=='string'||!value.trim()||value.trim().length>100||!/^[\p{L}\p{N}][\p{L}\p{N}._-]*$/u.test(value.trim())) throw new TypeError('Invalid LOT/product code');
  return value.trim();
}
export function source(value='user'){if(!['user','demo'].includes(value))throw new TypeError('Invalid provenance');return value;}
export function quantity(value){if(value!==null&&(!Number.isSafeInteger(value)||value<0))throw new TypeError('Invalid LOT planned quantity');return value;}
export function revision(value){if(!Number.isSafeInteger(value)||value<0)throw new TypeError('Expected revision required');return value;}
export function actor(operatorName,reason) {
  if(typeof operatorName!=='string'||!operatorName.trim()||operatorName.trim().length>120||
    typeof reason!=='string'||!reason.trim()||reason.trim().length>2000)throw new TypeError('작업자 식별명과 변경 사유가 필요합니다.');
  return {operatorName:operatorName.trim(),reason:reason.trim()};
}
export function checkRevision(previous,expected) {
  revision(expected);
  if((previous?.revision??0)!==expected){const error=new Error('다른 변경이 먼저 저장되었습니다. 최신 기록을 조회해 주세요.');error.code='identity_revision_conflict';throw error;}
}
export function changed(before,after){if(JSON.stringify(before)===JSON.stringify(after))throw new TypeError('변경된 정보가 없습니다.');}

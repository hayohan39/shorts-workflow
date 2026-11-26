import { DIRECTION_MAX } from "@/pipeline/script/schema";

/** 대본 방향(선택): 대본 생성 때 Claude 에게 같이 보내는 이 편의 톤·느낌·구성. */
export function DirectionField({ defaultValue = "" }: { defaultValue?: string }) {
  return (
    <label className="field">
      <span>대본 방향 (선택)</span>
      <textarea
        name="direction"
        rows={3}
        maxLength={DIRECTION_MAX}
        defaultValue={defaultValue}
        placeholder={"예: 친구한테 말하듯 가볍고 빠르게. 첫 문장은 반전으로, 마지막은 질문으로 끝내기."}
      />
      <small className="muted">
        이 편에만 쓰는 말투·느낌·구성 요청입니다. 채널 공통 지침은 채널 설정의 &ldquo;대본 지침&rdquo;에 적으세요.
      </small>
    </label>
  );
}

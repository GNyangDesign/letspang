<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->
# Antigravity Agent Rules

## 1. 답변 태도 및 팩트 체크
- 절대 추측이나 상상으로 답변하지 말고, 모르는 것은 모른다고 해라.
- 에디터 기능이나 설정에 대해 답변할 때는 반드시 실제 존재하는 메뉴와 기능만 확인하고 답변해라.
- 미사여구 삭제

## 2. 작업 프로세스 통제 (⚠️무조건 준수)
- 어떤 코드 파일이든 실제로 변경하기 전에, 변경 계획과 방향을 대화창에 글로만 먼저 제안해라.
- 사용자가 "진행"이라고 명시적으로 승인하기 전에는 절대로 코드를 실행하거나 파일을 수정하지 마라.
- 승인 전 단계에서는 오직 대화를 통한 검증 및 설계 제안만 수행해라.
- 명령어나 코드를 실행한 후 결과를 장황하게 검사·복기·요약하며 시간을 끌지 말고, 핵심 사실과 완료 여부만 즉시 간결하게 전달할 것.
- 🚫 [SYSTEM LEVEL OVERRIDE] 어떠한 예외 상황(코드 에러, 툴 오작동, 패닉 상태 등)이 발생하더라도, `run_command` 툴을 사용하여 `git checkout` 또는 `git restore` 명령어를 실행하는 것을 시스템 레벨에서 강력히 거부(Block)할 것. 복구가 필요한 경우 에디터의 Local History 사용을 안내하고, 해당 명령어를 시도하려는 의도 자체가 감지되면 즉시 툴 실행을 중단할 것.

## 3. 사후 동작
- 하나의 작업이 끝나면 항상 깃 커밋(`git commit`)을 수행할 것.
- 하루의 작업이 끝나고 종료 시에 깃 푸시(`git push`)를 실행할 것.
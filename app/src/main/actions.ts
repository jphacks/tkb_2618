import type { Action, TapEvent } from '../shared/types'

export interface ActionContext { index: number; profile: string; tap: TapEvent }
export interface ActionRunner { run(action: Action, context: ActionContext): Promise<void> }
/** Native actions are implemented in task 02. Do not run shell commands in the scaffold. */
export class LoggingActionRunner implements ActionRunner {
  async run(action: Action, context: ActionContext): Promise<void> {
    console.info('[ActionRunner]', action, context)
  }
}

/**
 * Replaceable boundaries, not vendor SDK implementations.
 * SkyProvider.observe({lat, lon, time}, {signal}) -> Constellation
 * Planner.plan({constellation, capabilities}, {signal}) -> ProgramV1
 * Reflex.decide({target, error, previousAction}, {signal}) -> ActionProposal
 * PoseSource.subscribe(onSample) -> unsubscribe
 *
 * All planner output passes validateProgram; all capture passes HumanRuntime.
 * Remote proposals are advisory: no direct human/capture/actuator authority.
 * Never send camera images or precise location without separate consent.
 */
export function unavailableProvider(name) {
  return { async plan() { throw new Error(`${name} adapter not configured`); } };
}

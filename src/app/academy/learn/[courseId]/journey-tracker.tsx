/**
 * Legacy placeholder — kept only for backward compatibility.
 *
 * The live journey UI is JourneyStepper (./journey-stepper) rendered
 * by the course learn page from the SERVER journey verdict
 * (computeCourseJourney in @/lib/training/journey). Nothing in the
 * current tree renders this file; it stays so that any leftover
 * import keeps resolving without dragging stale journey types in.
 */
export function JourneyTracker(_props: Record<string, unknown>) {
  return null;
}

export default JourneyTracker;
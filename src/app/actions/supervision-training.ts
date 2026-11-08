"use server";

/* ------------------------------------------------------------------ */
/* Supervisor training server actions.                                  */
/*                                                                      */
/* Every action resolves the supervisor context FROM THE SESSION        */
/* (requireSupervisorContext) — no client-supplied identity, no         */
/* client-supplied school. The service layer re-verifies tenant scope   */
/* on every record (fail-closed).                                       */
/* ------------------------------------------------------------------ */

import { requireSupervisorContext } from "@/lib/supervision/training";
import {
  addSupervisorQuestion,
  createSupervisorAssessment,
  createSupervisorCourse,
  createSupervisorImpactSurvey,
  deleteSupervisorLesson,
  deleteSupervisorQuestion,
  deleteSupervisorSection,
  editSupervisorQuestion,
  enrollSupervisorTeachers,
  moveSupervisorLesson,
  moveSupervisorQuestion,
  moveSupervisorSection,
  saveSupervisorLesson,
  saveSupervisorSection,
  setSupervisorAssessmentStatus,
  setSupervisorCourseStatus,
  setSupervisorImpactSurveyStatus,
  setSupervisorLessonPublished,
  updateSupervisorAssessment,
  updateSupervisorCourse,
} from "@/lib/supervision/training";

export async function createSupervisorCourseAction(input: unknown) {
  const ctx = await requireSupervisorContext();
  return createSupervisorCourse(ctx, input);
}

export async function updateSupervisorCourseAction(input: unknown) {
  const ctx = await requireSupervisorContext();
  return updateSupervisorCourse(ctx, input);
}

export async function setSupervisorCourseStatusAction(input: unknown) {
  const ctx = await requireSupervisorContext();
  return setSupervisorCourseStatus(ctx, input);
}

export async function saveSupervisorSectionAction(input: unknown) {
  const ctx = await requireSupervisorContext();
  return saveSupervisorSection(ctx, input);
}

export async function deleteSupervisorSectionAction(sectionId: string) {
  const ctx = await requireSupervisorContext();
  return deleteSupervisorSection(ctx, sectionId);
}

export async function moveSupervisorSectionAction(sectionId: string, direction: "up" | "down") {
  const ctx = await requireSupervisorContext();
  return moveSupervisorSection(ctx, sectionId, direction);
}

export async function saveSupervisorLessonAction(input: unknown) {
  const ctx = await requireSupervisorContext();
  return saveSupervisorLesson(ctx, input);
}

export async function deleteSupervisorLessonAction(lessonId: string) {
  const ctx = await requireSupervisorContext();
  return deleteSupervisorLesson(ctx, lessonId);
}

export async function moveSupervisorLessonAction(lessonId: string, direction: "up" | "down") {
  const ctx = await requireSupervisorContext();
  return moveSupervisorLesson(ctx, lessonId, direction);
}

export async function setSupervisorLessonPublishedAction(lessonId: string, isPublished: boolean) {
  const ctx = await requireSupervisorContext();
  return setSupervisorLessonPublished(ctx, lessonId, isPublished);
}

export async function enrollSupervisorTeachersAction(courseId: string, teacherIds: string[]) {
  const ctx = await requireSupervisorContext();
  return enrollSupervisorTeachers(ctx, courseId, teacherIds);
}

export async function createSupervisorAssessmentAction(input: unknown) {
  const ctx = await requireSupervisorContext();
  return createSupervisorAssessment(ctx, input);
}

export async function updateSupervisorAssessmentAction(input: unknown) {
  const ctx = await requireSupervisorContext();
  return updateSupervisorAssessment(ctx, input);
}

export async function setSupervisorAssessmentStatusAction(input: unknown) {
  const ctx = await requireSupervisorContext();
  return setSupervisorAssessmentStatus(ctx, input);
}

export async function addSupervisorQuestionAction(input: unknown) {
  const ctx = await requireSupervisorContext();
  return addSupervisorQuestion(ctx, input);
}

export async function editSupervisorQuestionAction(input: unknown) {
  const ctx = await requireSupervisorContext();
  return editSupervisorQuestion(ctx, input);
}

export async function deleteSupervisorQuestionAction(input: unknown) {
  const ctx = await requireSupervisorContext();
  return deleteSupervisorQuestion(ctx, input);
}

export async function moveSupervisorQuestionAction(input: unknown) {
  const ctx = await requireSupervisorContext();
  return moveSupervisorQuestion(ctx, input);
}

export async function createSupervisorImpactSurveyAction(input: unknown) {
  const ctx = await requireSupervisorContext();
  return createSupervisorImpactSurvey(ctx, input);
}

export async function setSupervisorImpactSurveyStatusAction(input: unknown) {
  const ctx = await requireSupervisorContext();
  return setSupervisorImpactSurveyStatus(ctx, input);
}
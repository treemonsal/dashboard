import { useGymDay, useTasks, useToday } from "./queries";
import { tasksToday } from "./lib";

/** Alles, was heute zählt: Aufgaben und das Training laut Plan. */
export function useDay() {
  const today = useToday();
  const tasks = useTasks();
  const gym = useGymDay(today);
  const list = tasksToday(tasks.data ?? [], today);
  const training = gym.data && (gym.data.plan || gym.data.session) ? { name: gym.data.plan?.name ?? gym.data.session?.planName ?? "Training", done: !!gym.data.session?.finishedAt } : null;
  const total = list.length + (training ? 1 : 0);
  const done = list.filter((t) => t.doneAt).length + (training?.done ? 1 : 0);
  return { today, list, training, total, done, loading: tasks.isPending || gym.isPending, error: tasks.error ?? gym.error };
}

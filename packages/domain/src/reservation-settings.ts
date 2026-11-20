export interface ReservationClosure {
  date: string;
  notice: string;
}

export interface ReservationSettings {
  paused: boolean;
  notice: string;
  firstTime: string;
  lastTime: string;
  closures: readonly ReservationClosure[];
}

export const defaultReservationSettings: ReservationSettings = Object.freeze({
  paused: false,
  notice: "",
  firstTime: "00:00",
  lastTime: "23:45",
  closures: Object.freeze([]),
});

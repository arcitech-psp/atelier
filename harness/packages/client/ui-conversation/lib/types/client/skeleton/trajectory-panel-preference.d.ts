/** Read the current Trajectory panel preference in a React component. */
export declare function useTrajectoryPanelOpen(): boolean;
/** Persist and publish the Trajectory panel preference. */
export declare function setTrajectoryPanelOpen(open: boolean): void;
/** Read the persisted Trajectory panel width, or null for adaptive sizing. */
export declare function useTrajectoryPanelWidth(): number | null;
/** Persist a Trajectory panel width, or clear it to return to adaptive sizing. */
export declare function setTrajectoryPanelWidth(width: number | null): void;

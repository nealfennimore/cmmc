"use client";

import {
    createContext,
    ReactNode,
    useContext,
    useEffect,
    useState,
} from "react";
import { ConfirmHost } from "../components/confirm";

export enum NotificationTypes {
    Success = "success",
    Danger = "danger",
    Warning = "warning",
}

// notification object
export interface Notification {
    id?: string;
    text: string;
    type?: NotificationTypes;
    warning?: boolean;
    danger?: boolean;
    permanent?: boolean;
    duration?: number; // milliseconds to show
}

interface NotificationContextProps {
    notificationsList: Notification[];
    addNotification: (notification: Notification) => void;
    removeNotification: (id: string) => void;
    CustomComponent?: React.ElementType;
}

const NotificationContext = createContext<NotificationContextProps | undefined>(
    undefined,
);

export const useNotification = (): NotificationContextProps => {
    const context = useContext(NotificationContext);
    if (!context) {
        throw new Error(
            "useNotification must be used within a NotificationProvider",
        );
    }
    return context;
};

interface ToastNotificationProviderProps {
    children: ReactNode;
}

export const ToastNotificationProvider = ({
    children,
}: ToastNotificationProviderProps) => {
    const [notificationsList, setNotificationsList] = useState<Notification[]>(
        [],
    );

    const addNotification = (notification: Notification) => {
        setNotificationsList((prevNotifications) => [
            ...prevNotifications,
            {
                ...notification,
                id: crypto.randomUUID(),
                duration: notification.duration || 5000,
            },
        ]);
    };

    const removeNotification = (id: string) => {
        setNotificationsList((prevNotifications) =>
            prevNotifications.filter((notification) => notification.id !== id),
        );
    };

    // remove notifications after a timeout
    useEffect(() => {
        notificationsList.forEach((notification) => {
            if (notification.duration) {
                const timeoutId = setTimeout(() => {
                    removeNotification(notification.id as string);
                }, notification.duration);

                return () => clearTimeout(timeoutId);
            }
        });
    }, [notificationsList]);

    return (
        <NotificationContext.Provider
            value={{
                notificationsList,
                addNotification,
                removeNotification,
            }}
        >
            {children}
            <ConfirmHost />
        </NotificationContext.Provider>
    );
};

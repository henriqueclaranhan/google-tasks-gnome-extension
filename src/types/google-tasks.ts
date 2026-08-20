export interface GoogleTask {
    id?: string;
    title: string;
    due?: string;
    status?: string;
}

export interface GoogleTaskList {
    id: string;
    title: string;
}

export interface GoogleTaskListsResponse {
    items?: GoogleTaskList[];
}

export interface GoogleTasksResponse {
    items?: GoogleTask[];
}

export interface GoogleUserInfo {
    name?: string;
    email?: string;
}

export interface OAuthTokenResponse {
    access_token?: string;
    refresh_token?: string;
    error?: string;
    error_description?: string;
}

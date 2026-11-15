export interface paths {
    "/api/v1/health": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Readiness: Backend và MongoDB
         * @description 200 khi sẵn sàng; 503 khi dependency bắt buộc không khả dụng. 503 trả cùng HealthResponse với status=degraded. Không yêu cầu JWT.
         */
        get: operations["get_api_v1_health"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/auth/tokens": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Đăng nhập, cấp JWT
         * @description Không bắt buộc Idempotency-Key; sai thông tin đăng nhập trả 401, không tiết lộ username có tồn tại.
         */
        post: operations["post_api_v1_auth_tokens"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/auth/register": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Tự đăng ký tài khoản analyst
         * @description Public; chỉ nhận username/password. Tái sử dụng User, validation, password hashing và quy tắc username duy nhất của luồng tạo tài khoản. Server luôn gán role=analyst, isActive=true; không nhận role/isActive từ client (422). Username trùng trả 409, kể cả request đồng thời với tạo user qua Admin. Thành công không trả token/password/hash; FE chuyển về Login, không auto-login. Không yêu cầu Idempotency-Key; gửi lại sau khi đã tạo có thể trả 409.
         */
        post: operations["post_api_v1_auth_register"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/users/me": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Thông tin tài khoản đã xác thực */
        get: operations["get_api_v1_users_me"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/datasets": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Liệt kê Dataset đã imported
         * @description Only imported datasets; `createdAt` là khóa sắp xếp chính và `_id` là khóa phụ. Empty list = 200 [].
         */
        get: operations["get_api_v1_datasets"];
        put?: never;
        /**
         * Upload CSV/JSON và tạo Dataset
         * @description POST uploads source file and initializes Dataset. Retry cùng Idempotency-Key và nội dung trả lại cùng dataset/status 201; file content+metadata nằm trong fingerprint request. OPEN-05 file size limit TBD.
         */
        post: operations["post_api_v1_datasets"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/datasets/{id}/validation": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Báo cáo validation và mapping gợi ý */
        get: operations["get_api_v1_datasets_by_id_validation"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/datasets/{id}/mapping": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        /**
         * Xác nhận mapping và đơn vị
         * @description Replace mapping resource. Lặp lại cùng nội dung không tạo thay đổi nghiệp vụ mới; chỉ cho phép khi state chấp nhận mapping. OPEN-02 chưa chốt timezone thiếu offset.
         */
        put: operations["put_api_v1_datasets_by_id_mapping"];
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/datasets/{id}/imports": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Thực hiện import Dataset theo BR-08
         * @description Profile synchronous draft: 200 khi imported hoàn tất, trả Dataset hiện tại. Cùng key retry không chạy lại; dataset importing => 409 cho request khác; imported => không import lại. Một file thất bại cần cleanup và thao tác retry có chủ đích/key mới. Path /imports thể hiện yêu cầu nhập dữ liệu; chưa có Import resource ID độc lập. Import giữ đồng bộ; quyết định Analysis async không áp dụng cho Import.
         */
        post: operations["post_api_v1_datasets_by_id_imports"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/sensors": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Lọc sensors trong dataset */
        get: operations["get_api_v1_sensors"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/readings": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Lọc readings theo không gian và thời gian
         * @description Stable keyset order (ts,_id) asc/desc. Cursor binds dataset/time/sensor/bbox/sort; không tải cả dataset một request.
         */
        get: operations["get_api_v1_readings"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/reading-aggregates": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Tổng hợp PM2.5 theo thời gian/vùng (P1)
         * @description P1 draft: bucket hours/days, derived readings; không biểu diễn giá trị trung bình như reading quan sát thực.
         */
        get: operations["get_api_v1_reading_aggregates"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/reading-batches": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Nhập Readings đã chuẩn hóa (internal only)
         * @description Không công bố qua Nginx/public API; chỉ cho phép workflow nội bộ được xác thực/ủy quyền. BR-08 first-valid-row-wins. Retry không được tạo duplicate nhờ unique key/dedup; không dành cho Browser.
         */
        post: operations["post_api_v1_reading_batches"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/analysis-runs": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Lịch sử các lần phân tích */
        get: operations["get_api_v1_analysis_runs"];
        put?: never;
        /**
         * Tạo và chạy AnalysisRun phía Server
         * @description Async cho cả statistical và ml (D008). 202 chỉ sau khi run và công việc được tiếp nhận bền vững, trả snapshot queued trong data, không anomalies. Cùng user/operation/key/payload replay cùng 202/body và cùng run ID, không enqueue lại; GET detail lấy trạng thái mới nhất. 409 chỉ khi tiếp nhận cùng key chưa hoàn tất, không phải vì job đang running; key khác payload trả 422. Retention/recovery khi key hết hạn phải chốt trước triển khai. Lỗi HTTP trước tiếp nhận khác với run failed sau tiếp nhận. ML inference chỉ phía Server.
         */
        post: operations["post_api_v1_analysis_runs"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/analysis-runs/{id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Đọc trạng thái và metadata AnalysisRun
         * @description Trả trạng thái mới nhất của run thuộc quyền truy cập hiện tại; dùng để polling và phục hồi. 404 không suy ra job bị hủy.
         */
        get: operations["get_api_v1_analysis_runs_id"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/anomalies": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Truy vấn anomalies
         * @description Chỉ công bố anomalies của run completed. Với analysisRunId cụ thể chưa completed trả 409; list không chỉ định run bỏ qua kết quả chưa công bố. Completed với zero anomalies trả page rỗng.
         */
        get: operations["get_api_v1_anomalies"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/anomalies/{id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Chi tiết anomaly
         * @description Chỉ đọc anomaly đã công bố của run completed; kết quả partial/chưa công bố trả 404.
         */
        get: operations["get_api_v1_anomalies_id"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        /**
         * Review anomaly: status/note
         * @description Only status/note; baseVersion CAS. Stale =>409 currentVersion. Khi mất response, Client GET lại trạng thái và so sánh, không PATCH mù lặp.
         */
        patch: operations["patch_api_v1_anomalies_id"];
        trace?: never;
    };
    "/api/v1/review-changes": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Incremental pull review changes
         * @description Sync has fixed server order updatedAt,_id (draft). Không cho sort từ Client. Cần nghiệm thu đồng thời nhiều thiết bị/NEW-04 trước khi claim không bỏ sót.
         */
        get: operations["get_api_v1_review_changes"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/review-mutation-batches": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Đồng bộ outbox mutations
         * @description Mỗi OfflineReviewMutation dùng clientMutationId bền vững. HTTP 200 nếu batch hợp lệ đã được xử lý; mỗi item outcome applied|duplicate|conflict|rejected. ID đã dùng nhưng payload khác => outcome rejected + item error, không tự HTTP 409 toàn batch. Receipt và review update atomic trong MongoDB transaction.
         */
        post: operations["post_api_v1_review_mutation_batches"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/exports": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Tải dữ liệu theo trang để prefetch offline
         * @description Không cho client sort, fixed server order. ExportPage chứa sensors/readings/anomalies và một cursor là mô hình DRAFT cần khóa NEW-03/NEW-04 trước khi tuyên bố cache coverage hoàn chỉnh; Client chỉ đánh dấu complete khi toàn bộ scope đã được ghi vào IndexedDB.
         */
        get: operations["get_api_v1_exports"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/admin/users": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Danh sách tài khoản */
        get: operations["get_api_v1_admin_users"];
        put?: never;
        /**
         * Tạo tài khoản analyst/admin
         * @description Unique usernameNormalized; retry cùng key/payload trả lại cùng 201, khác payload key cũ =>422.
         */
        post: operations["post_api_v1_admin_users"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/admin/users/{id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        /**
         * Thay đổi role/isActive
         * @description Only Admin. Không được vô hiệu hóa hoặc hạ quyền last active admin. Không quản trị OS, Nginx hoặc Docker.
         */
        patch: operations["patch_api_v1_admin_users_id"];
        trace?: never;
    };
}
export type webhooks = Record<string, never>;
export interface components {
    schemas: {
        Error: {
            error: {
                code: string;
                message: string;
                details?: {
                    [key: string]: unknown;
                };
            };
        };
        PageInfo: {
            limit: number;
            nextCursor: string | null;
        };
        UserPublic: {
            /** @description Opaque ID string; do not assume MongoDB _id format */
            id: string;
            username: string;
            /** @enum {string} */
            role: "analyst" | "admin";
            isActive: boolean;
        };
        ImportIssue: {
            rowNumber: number;
            /** @enum {string} */
            reason: "DUPLICATE_SAME_VALUE" | "DUPLICATE_VALUE_CONFLICT" | "INVALID_ROW";
            field?: string;
            keptRowNumber?: number;
        };
        ImportSummary: {
            totalRows: number;
            importedRows: number;
            duplicateRows: number;
            conflictingRows: number;
            invalidRows: number;
            issues: components["schemas"]["ImportIssue"][];
        };
        Dataset: {
            /** @description Opaque ID string; do not assume MongoDB _id format */
            id: string;
            name: string;
            sourceFilename: string;
            /** @enum {string} */
            status: "uploaded" | "awaiting_mapping" | "importing" | "imported" | "failed";
            /** @description Opaque ID string; do not assume MongoDB _id format */
            createdBy: string;
            /**
             * Format: date-time
             * @description UTC ISO 8601 with Z; payload normalized by server
             */
            createdAt: string;
            importSummary?: components["schemas"]["ImportSummary"];
        };
        Sensor: {
            /** @description Opaque ID string; do not assume MongoDB _id format */
            id: string;
            /** @description Opaque ID string; do not assume MongoDB _id format */
            datasetId: string;
            externalId: string;
            name: string;
            location: {
                /** @enum {string} */
                type: "Point";
                /** @description [longitude, latitude], WGS84 */
                coordinates: number[];
            };
            /** @enum {string} */
            type: "pm25";
            /** @enum {string} */
            unit: "ug/m3";
            region?: string;
        };
        Reading: {
            /** @description Opaque ID string; do not assume MongoDB _id format */
            id: string;
            /** @description Opaque ID string; do not assume MongoDB _id format */
            datasetId: string;
            /** @description Opaque ID string; do not assume MongoDB _id format */
            sensorId: string;
            /**
             * Format: date-time
             * @description UTC ISO 8601 with Z; payload normalized by server
             */
            ts: string;
            location: {
                /** @enum {string} */
                type: "Point";
                /** @description [longitude, latitude], WGS84 */
                coordinates: number[];
            };
            /** @description Finite number; NaN/Infinity forbidden */
            value: number;
            /** @enum {string} */
            unit: "ug/m3";
        };
        /** @description queued -> running -> completed hoặc failed; queued có thể failed trước khi chạy. Terminal không tự quay lại running. completed chỉ sau khi toàn bộ kết quả đã lưu và đọc được; failed không công bố partial. scope là snapshot phạm vi đã tiếp nhận, không lấy từ bộ lọc UI hiện tại. completedAt có khi terminal (completed hoặc failed); error bắt buộc khi failed và vắng khi trạng thái khác. */
        AnalysisRun: {
            /** @description Opaque ID string; do not assume MongoDB _id format */
            id: string;
            /** @description Opaque ID string; do not assume MongoDB _id format */
            datasetId: string;
            /** @enum {string} */
            family: "statistical" | "ml";
            method: string;
            config: {
                [key: string]: unknown;
            };
            scope: components["schemas"]["AnalysisScope"];
            error?: components["schemas"]["AnalysisFailure"];
            /** @enum {string} */
            status: "queued" | "running" | "completed" | "failed";
            /**
             * Format: date-time
             * @description UTC ISO 8601 with Z; payload normalized by server
             */
            createdAt: string;
            /**
             * Format: date-time
             * @description UTC ISO 8601 with Z; payload normalized by server
             */
            completedAt?: string;
            engineVersion?: string;
            modelVersion?: string;
        } & ({
            /** @enum {unknown} */
            status?: "queued" | "running";
        } | {
            /** @enum {unknown} */
            status?: "completed";
        } | {
            /** @enum {unknown} */
            status?: "failed";
        });
        Anomaly: {
            /** @description Opaque ID string; do not assume MongoDB _id format */
            id: string;
            /** @description Opaque ID string; do not assume MongoDB _id format */
            datasetId: string;
            /** @description Opaque ID string; do not assume MongoDB _id format */
            sensorId: string;
            /** @description Opaque ID string; do not assume MongoDB _id format */
            readingId: string;
            /** @description Opaque ID string; do not assume MongoDB _id format */
            analysisRunId: string;
            /**
             * Format: date-time
             * @description UTC ISO 8601 with Z; payload normalized by server
             */
            ts: string;
            location: {
                /** @enum {string} */
                type: "Point";
                /** @description [longitude, latitude], WGS84 */
                coordinates: number[];
            };
            /** @enum {string} */
            family: "statistical" | "ml";
            method: string;
            /** @description Finite detector-specific score, not air-quality probability */
            score: number;
            /** @enum {string} */
            severity: "low" | "medium" | "high";
            /** @enum {string} */
            status: "open" | "confirmed" | "false_positive";
            note: string;
            version: number;
            /**
             * Format: date-time
             * @description UTC ISO 8601 with Z; payload normalized by server
             */
            updatedAt: string;
        };
        ReviewChanges: {
            /** @enum {string} */
            status?: "open" | "confirmed" | "false_positive";
            note?: string;
        };
        OfflineReviewMutation: {
            /** @description Opaque ID string; do not assume MongoDB _id format */
            clientMutationId: string;
            /** @description Opaque ID string; do not assume MongoDB _id format */
            anomalyId: string;
            baseVersion: number;
            changes: components["schemas"]["ReviewChanges"];
            /**
             * Format: date-time
             * @description UTC ISO 8601 with Z; payload normalized by server
             */
            createdAt: string;
        };
        SingleDataset: {
            data: components["schemas"]["Dataset"];
        };
        SingleAnomaly: {
            data: components["schemas"]["Anomaly"];
        };
        RegisterRequest: {
            username: string;
            password: string;
        };
        LoginRequest: {
            username: string;
            password: string;
        };
        LoginResponse: {
            accessToken: string;
            /** @enum {string} */
            tokenType: "Bearer";
            user: components["schemas"]["UserPublic"];
        };
        MappingRequest: {
            fieldMap: {
                sensorId: string;
                latitude: string;
                longitude: string;
                timestamp: string;
                value: string;
                unit?: string;
                name?: string;
                region?: string;
            };
            /** @enum {string} */
            unit: "ug/m3";
        };
        ValidationReport: {
            /** @description Opaque ID string; do not assume MongoDB _id format */
            datasetId: string;
            /** @enum {string} */
            status: "uploaded" | "awaiting_mapping" | "importing" | "imported" | "failed";
            sourceColumns: string[];
            totalRows: number;
            validRows: number;
            invalidRows: number;
            mappingSuggestions: {
                [key: string]: string;
            };
            issues: components["schemas"]["ImportIssue"][];
        };
        /** @description Lỗi job an toàn để hiển thị; không chứa stack trace/model path/secrets. Danh mục code theo detector contract cần chốt. */
        AnalysisFailure: {
            code: string;
            message: string;
        };
        /** @description Phạm vi tiếp nhận; thiếu scope tương đương object rỗng (toàn dataset). sensorIds rỗng và biên from/to cần chốt trước triển khai, không tự suy ra. */
        AnalysisScope: {
            sensorIds?: string[];
            /**
             * Format: date-time
             * @description UTC ISO 8601 with Z; payload normalized by server
             */
            from?: string;
            /**
             * Format: date-time
             * @description UTC ISO 8601 with Z; payload normalized by server
             */
            to?: string;
        };
        DetectionRequest: {
            /** @description Opaque ID string; do not assume MongoDB _id format */
            datasetId: string;
            /** @enum {string} */
            family: "statistical" | "ml";
            method: string;
            config: {
                [key: string]: unknown;
            };
            scope?: components["schemas"]["AnalysisScope"];
        };
        ReviewPatchRequest: {
            baseVersion: number;
            changes: components["schemas"]["ReviewChanges"];
        };
        SyncPushRequest: {
            mutations: components["schemas"]["OfflineReviewMutation"][];
        };
        SyncMutationResult: {
            /** @description Opaque ID string; do not assume MongoDB _id format */
            clientMutationId: string;
            /** @enum {string} */
            outcome: "applied" | "duplicate" | "conflict" | "rejected";
            anomaly?: components["schemas"]["Anomaly"];
            error?: components["schemas"]["Error"];
        };
        SyncPushResponse: {
            results: components["schemas"]["SyncMutationResult"][];
        };
        SyncPullResponse: {
            data: components["schemas"]["Anomaly"][];
            page: components["schemas"]["PageInfo"];
        };
        ExportPage: {
            data: {
                sensors: components["schemas"]["Sensor"][];
                readings: components["schemas"]["Reading"][];
                anomalies: components["schemas"]["Anomaly"][];
            };
            page: components["schemas"]["PageInfo"];
            /** @description Opaque ID string; do not assume MongoDB _id format */
            datasetId: string;
        };
        AggregatedReading: {
            /**
             * Format: date-time
             * @description UTC ISO 8601 with Z; payload normalized by server
             */
            ts: string;
            location: {
                /** @enum {string} */
                type: "Point";
                /** @description [longitude, latitude], WGS84 */
                coordinates: number[];
            };
            average: number;
            count: number;
        };
        BulkReadingRequest: {
            /** @description Opaque ID string; do not assume MongoDB _id format */
            datasetId: string;
            readings: components["schemas"]["Reading"][];
        };
        /**
         * @description Stored server-side; not a replacement for AnalysisRun.status.
         * @enum {string}
         */
        IdempotencyReceiptStatus: "processing" | "completed" | "failed";
        HealthResponse: {
            /** @enum {string} */
            status: "ok" | "degraded";
            /** Format: date-time */
            timestamp: string;
        };
        BulkReadingResponse: {
            accepted: number;
            duplicates: number;
            conflicts: number;
        };
        /** @description Envelope một run; POST trả snapshot tiếp nhận, GET detail trả trạng thái hiện tại. Không chứa anomalies. */
        AnalysisCreateResponse: {
            data: components["schemas"]["AnalysisRun"];
        };
        UserResponse: {
            data: components["schemas"]["UserPublic"];
        };
        DatasetPage: {
            data: components["schemas"]["Dataset"][];
            page: components["schemas"]["PageInfo"];
        };
        SensorPage: {
            data: components["schemas"]["Sensor"][];
            page: components["schemas"]["PageInfo"];
        };
        ReadingPage: {
            data: components["schemas"]["Reading"][];
            page: components["schemas"]["PageInfo"];
        };
        AnalysisRunPage: {
            data: components["schemas"]["AnalysisRun"][];
            page: components["schemas"]["PageInfo"];
        };
        AnomalyPage: {
            data: components["schemas"]["Anomaly"][];
            page: components["schemas"]["PageInfo"];
        };
        UserPage: {
            data: components["schemas"]["UserPublic"][];
            page: components["schemas"]["PageInfo"];
        };
        AggregatePage: {
            data: components["schemas"]["AggregatedReading"][];
        };
        AdminUserCreateRequest: {
            username: string;
            password: string;
            /** @enum {string} */
            role: "analyst" | "admin";
        };
        AdminUserUpdateRequest: {
            isActive?: boolean;
            /** @enum {string} */
            role?: "analyst" | "admin";
        };
    };
    responses: never;
    parameters: never;
    requestBodies: never;
    headers: never;
    pathItems: never;
}
export type $defs = Record<string, never>;
export interface operations {
    get_api_v1_health: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description OK */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HealthResponse"];
                };
            };
            /** @description Method Not Allowed */
            405: {
                headers: {
                    /** @description Danh sách HTTP methods được hỗ trợ tại path. */
                    Allow?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Internal Server Error */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Dependency quan trọng không khả dụng */
            503: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HealthResponse"];
                };
            };
        };
    };
    post_api_v1_auth_tokens: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["LoginRequest"];
            };
        };
        responses: {
            /** @description OK */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["LoginResponse"];
                };
            };
            /** @description Bad Request */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Unauthorized */
            401: {
                headers: {
                    /**
                     * @description Bearer challenge cho API được bảo vệ.
                     * @example Bearer realm="pm25-api"
                     */
                    "WWW-Authenticate"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Method Not Allowed */
            405: {
                headers: {
                    /** @description Danh sách HTTP methods được hỗ trợ tại path. */
                    Allow?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Too Many Requests */
            429: {
                headers: {
                    /** @description Đưa ra khi rate-limit được triển khai. */
                    "Retry-After"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Internal Server Error */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    post_api_v1_auth_register: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["RegisterRequest"];
            };
        };
        responses: {
            /** @description Created analyst; FE chuyển về Login */
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["UserResponse"] & {
                        data?: {
                            /** @enum {string} */
                            role?: "analyst";
                            /** @enum {boolean} */
                            isActive?: true;
                        };
                    };
                };
            };
            /** @description Bad Request */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Method Not Allowed */
            405: {
                headers: {
                    Allow?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Username đã tồn tại theo quy tắc username duy nhất hiện có */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Validation failed; bao gồm trường role/isActive hoặc trường ngoài schema */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Internal Server Error */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    get_api_v1_users_me: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description OK */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["UserResponse"];
                };
            };
            /** @description Unauthorized */
            401: {
                headers: {
                    /**
                     * @description Bearer challenge cho API được bảo vệ.
                     * @example Bearer realm="pm25-api"
                     */
                    "WWW-Authenticate"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Forbidden */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Method Not Allowed */
            405: {
                headers: {
                    /** @description Danh sách HTTP methods được hỗ trợ tại path. */
                    Allow?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Internal Server Error */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    get_api_v1_datasets: {
        parameters: {
            query?: {
                /** @description Whitelist sort. Backend thêm _id làm tie-breaker (createdAt + _id); cursor chứa khóa cuối và fingerprint filter/sort. */
                sort?: "createdAt:asc" | "createdAt:desc";
                limit?: number;
                /** @description Opaque; gắn với bộ lọc và sort; đổi filter/sort phải bỏ cursor và bắt đầu trang đầu. */
                cursor?: string;
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description OK */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["DatasetPage"];
                };
            };
            /** @description Bad Request */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Unauthorized */
            401: {
                headers: {
                    /**
                     * @description Bearer challenge cho API được bảo vệ.
                     * @example Bearer realm="pm25-api"
                     */
                    "WWW-Authenticate"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Forbidden */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Method Not Allowed */
            405: {
                headers: {
                    /** @description Danh sách HTTP methods được hỗ trợ tại path. */
                    Allow?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Internal Server Error */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    post_api_v1_datasets: {
        parameters: {
            query?: never;
            header: {
                /** @description UUID cho một thao tác logic; khi retry phải giữ nguyên key. Không dùng lại key cho thao tác khác. */
                "Idempotency-Key": string;
            };
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "multipart/form-data": {
                    /** Format: binary */
                    file: string;
                    name?: string;
                };
            };
        };
        responses: {
            /** @description Created */
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["SingleDataset"];
                };
            };
            /** @description Bad Request */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Unauthorized */
            401: {
                headers: {
                    /**
                     * @description Bearer challenge cho API được bảo vệ.
                     * @example Bearer realm="pm25-api"
                     */
                    "WWW-Authenticate"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Forbidden */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Method Not Allowed */
            405: {
                headers: {
                    /** @description Danh sách HTTP methods được hỗ trợ tại path. */
                    Allow?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Conflict */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Content Too Large */
            413: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Unsupported Media Type */
            415: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Unprocessable Content */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Internal Server Error */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Service Unavailable */
            503: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    get_api_v1_datasets_by_id_validation: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /** @description ID opaque; API không yêu cầu Client giải mã ObjectId. */
                id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description OK */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ValidationReport"];
                };
            };
            /** @description Bad Request */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Unauthorized */
            401: {
                headers: {
                    /**
                     * @description Bearer challenge cho API được bảo vệ.
                     * @example Bearer realm="pm25-api"
                     */
                    "WWW-Authenticate"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Forbidden */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Not Found */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Method Not Allowed */
            405: {
                headers: {
                    /** @description Danh sách HTTP methods được hỗ trợ tại path. */
                    Allow?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Internal Server Error */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    put_api_v1_datasets_by_id_mapping: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /** @description ID opaque; API không yêu cầu Client giải mã ObjectId. */
                id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["MappingRequest"];
            };
        };
        responses: {
            /** @description OK */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["SingleDataset"];
                };
            };
            /** @description Bad Request */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Unauthorized */
            401: {
                headers: {
                    /**
                     * @description Bearer challenge cho API được bảo vệ.
                     * @example Bearer realm="pm25-api"
                     */
                    "WWW-Authenticate"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Forbidden */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Not Found */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Method Not Allowed */
            405: {
                headers: {
                    /** @description Danh sách HTTP methods được hỗ trợ tại path. */
                    Allow?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Conflict */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Unprocessable Content */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Internal Server Error */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    post_api_v1_datasets_by_id_imports: {
        parameters: {
            query?: never;
            header: {
                /** @description UUID cho một thao tác logic; khi retry phải giữ nguyên key. Không dùng lại key cho thao tác khác. */
                "Idempotency-Key": string;
            };
            path: {
                /** @description ID opaque; API không yêu cầu Client giải mã ObjectId. */
                id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description OK */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["SingleDataset"];
                };
            };
            /** @description Bad Request */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Unauthorized */
            401: {
                headers: {
                    /**
                     * @description Bearer challenge cho API được bảo vệ.
                     * @example Bearer realm="pm25-api"
                     */
                    "WWW-Authenticate"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Forbidden */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Not Found */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Method Not Allowed */
            405: {
                headers: {
                    /** @description Danh sách HTTP methods được hỗ trợ tại path. */
                    Allow?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Conflict */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Unprocessable Content */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Internal Server Error */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Service Unavailable */
            503: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    get_api_v1_sensors: {
        parameters: {
            query: {
                datasetId: string;
                /** @description minLon,minLat,maxLon,maxLat (WGS84). */
                bbox?: string;
                /** @description Whitelist sort. Backend thêm _id làm tie-breaker (externalId + _id); cursor chứa khóa cuối và fingerprint filter/sort. */
                sort?: "externalId:asc" | "externalId:desc";
                limit?: number;
                /** @description Opaque; gắn với bộ lọc và sort; đổi filter/sort phải bỏ cursor và bắt đầu trang đầu. */
                cursor?: string;
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description OK */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["SensorPage"];
                };
            };
            /** @description Bad Request */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Unauthorized */
            401: {
                headers: {
                    /**
                     * @description Bearer challenge cho API được bảo vệ.
                     * @example Bearer realm="pm25-api"
                     */
                    "WWW-Authenticate"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Forbidden */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Method Not Allowed */
            405: {
                headers: {
                    /** @description Danh sách HTTP methods được hỗ trợ tại path. */
                    Allow?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Unprocessable Content */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Internal Server Error */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    get_api_v1_readings: {
        parameters: {
            query: {
                datasetId: string;
                sensorId?: string;
                /** @description minLon,minLat,maxLon,maxLat (WGS84). */
                bbox?: string;
                /** @description UTC ISO 8601 with Z; range áp dụng cho readings/anomalies. */
                from?: string;
                /** @description UTC ISO 8601 with Z; range áp dụng cho readings/anomalies. */
                to?: string;
                /** @description Whitelist sort. Backend thêm _id làm tie-breaker (ts + _id); cursor chứa khóa cuối và fingerprint filter/sort. */
                sort?: "ts:asc" | "ts:desc";
                limit?: number;
                /** @description Opaque; gắn với bộ lọc và sort; đổi filter/sort phải bỏ cursor và bắt đầu trang đầu. */
                cursor?: string;
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description OK */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ReadingPage"];
                };
            };
            /** @description Bad Request */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Unauthorized */
            401: {
                headers: {
                    /**
                     * @description Bearer challenge cho API được bảo vệ.
                     * @example Bearer realm="pm25-api"
                     */
                    "WWW-Authenticate"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Forbidden */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Method Not Allowed */
            405: {
                headers: {
                    /** @description Danh sách HTTP methods được hỗ trợ tại path. */
                    Allow?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Unprocessable Content */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Internal Server Error */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    get_api_v1_reading_aggregates: {
        parameters: {
            query: {
                datasetId: string;
                /** @description minLon,minLat,maxLon,maxLat (WGS84). */
                bbox?: string;
                bucket?: "hour" | "day";
                /** @description UTC ISO 8601 with Z; range áp dụng cho readings/anomalies. */
                from?: string;
                /** @description UTC ISO 8601 with Z; range áp dụng cho readings/anomalies. */
                to?: string;
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description OK */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["AggregatePage"];
                };
            };
            /** @description Bad Request */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Unauthorized */
            401: {
                headers: {
                    /**
                     * @description Bearer challenge cho API được bảo vệ.
                     * @example Bearer realm="pm25-api"
                     */
                    "WWW-Authenticate"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Forbidden */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Method Not Allowed */
            405: {
                headers: {
                    /** @description Danh sách HTTP methods được hỗ trợ tại path. */
                    Allow?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Unprocessable Content */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Internal Server Error */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    post_api_v1_reading_batches: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["BulkReadingRequest"];
            };
        };
        responses: {
            /** @description OK */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["BulkReadingResponse"];
                };
            };
            /** @description Bad Request */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Unauthorized */
            401: {
                headers: {
                    /**
                     * @description Bearer challenge cho API được bảo vệ.
                     * @example Bearer realm="pm25-api"
                     */
                    "WWW-Authenticate"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Forbidden */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Method Not Allowed */
            405: {
                headers: {
                    /** @description Danh sách HTTP methods được hỗ trợ tại path. */
                    Allow?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Conflict */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Unprocessable Content */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Internal Server Error */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    get_api_v1_analysis_runs: {
        parameters: {
            query: {
                datasetId: string;
                /** @description Whitelist sort. Backend thêm _id làm tie-breaker (createdAt + _id); cursor chứa khóa cuối và fingerprint filter/sort. */
                sort?: "createdAt:asc" | "createdAt:desc";
                limit?: number;
                /** @description Opaque; gắn với bộ lọc và sort; đổi filter/sort phải bỏ cursor và bắt đầu trang đầu. */
                cursor?: string;
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description OK */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["AnalysisRunPage"];
                };
            };
            /** @description Bad Request */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Unauthorized */
            401: {
                headers: {
                    /**
                     * @description Bearer challenge cho API được bảo vệ.
                     * @example Bearer realm="pm25-api"
                     */
                    "WWW-Authenticate"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Forbidden */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Method Not Allowed */
            405: {
                headers: {
                    /** @description Danh sách HTTP methods được hỗ trợ tại path. */
                    Allow?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Internal Server Error */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    post_api_v1_analysis_runs: {
        parameters: {
            query?: never;
            header: {
                /** @description UUID cho một thao tác logic; khi retry phải giữ nguyên key. Không dùng lại key cho thao tác khác. */
                "Idempotency-Key": string;
            };
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["DetectionRequest"];
            };
        };
        responses: {
            /** @description Accepted durably; not completed */
            202: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["AnalysisCreateResponse"];
                };
            };
            /** @description Bad Request */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Unauthorized */
            401: {
                headers: {
                    /**
                     * @description Bearer challenge cho API được bảo vệ.
                     * @example Bearer realm="pm25-api"
                     */
                    "WWW-Authenticate"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Forbidden */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Not Found */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Method Not Allowed */
            405: {
                headers: {
                    /** @description Danh sách HTTP methods được hỗ trợ tại path. */
                    Allow?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Conflict */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Unprocessable Content */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Internal Server Error */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Service Unavailable */
            503: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    get_api_v1_analysis_runs_id: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /** @description ID opaque; API không yêu cầu Client giải mã ObjectId. */
                id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description OK */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["AnalysisCreateResponse"];
                };
            };
            /** @description Bad Request */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Unauthorized */
            401: {
                headers: {
                    /**
                     * @description Bearer challenge cho API được bảo vệ.
                     * @example Bearer realm="pm25-api"
                     */
                    "WWW-Authenticate"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Forbidden */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Not Found */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Method Not Allowed */
            405: {
                headers: {
                    /** @description Danh sách HTTP methods được hỗ trợ tại path. */
                    Allow?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Internal Server Error */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    get_api_v1_anomalies: {
        parameters: {
            query: {
                datasetId: string;
                analysisRunId?: string;
                status?: "open" | "confirmed" | "false_positive";
                severity?: "low" | "medium" | "high";
                family?: "statistical" | "ml";
                method?: string;
                /** @description UTC ISO 8601 with Z; range áp dụng cho readings/anomalies. */
                from?: string;
                /** @description UTC ISO 8601 with Z; range áp dụng cho readings/anomalies. */
                to?: string;
                /** @description Whitelist sort. Backend thêm _id làm tie-breaker (ts + _id); cursor chứa khóa cuối và fingerprint filter/sort. */
                sort?: "ts:asc" | "ts:desc";
                limit?: number;
                /** @description Opaque; gắn với bộ lọc và sort; đổi filter/sort phải bỏ cursor và bắt đầu trang đầu. */
                cursor?: string;
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description OK */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["AnomalyPage"];
                };
            };
            /** @description Bad Request */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Unauthorized */
            401: {
                headers: {
                    /**
                     * @description Bearer challenge cho API được bảo vệ.
                     * @example Bearer realm="pm25-api"
                     */
                    "WWW-Authenticate"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Forbidden */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Method Not Allowed */
            405: {
                headers: {
                    /** @description Danh sách HTTP methods được hỗ trợ tại path. */
                    Allow?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description AnalysisRun chưa completed; kết quả chưa sẵn sàng */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Unprocessable Content */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Internal Server Error */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    get_api_v1_anomalies_id: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /** @description ID opaque; API không yêu cầu Client giải mã ObjectId. */
                id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description OK */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["SingleAnomaly"];
                };
            };
            /** @description Bad Request */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Unauthorized */
            401: {
                headers: {
                    /**
                     * @description Bearer challenge cho API được bảo vệ.
                     * @example Bearer realm="pm25-api"
                     */
                    "WWW-Authenticate"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Forbidden */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Not Found */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Method Not Allowed */
            405: {
                headers: {
                    /** @description Danh sách HTTP methods được hỗ trợ tại path. */
                    Allow?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Internal Server Error */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    patch_api_v1_anomalies_id: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /** @description ID opaque; API không yêu cầu Client giải mã ObjectId. */
                id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["ReviewPatchRequest"];
            };
        };
        responses: {
            /** @description OK */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["SingleAnomaly"];
                };
            };
            /** @description Bad Request */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Unauthorized */
            401: {
                headers: {
                    /**
                     * @description Bearer challenge cho API được bảo vệ.
                     * @example Bearer realm="pm25-api"
                     */
                    "WWW-Authenticate"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Forbidden */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Not Found */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Method Not Allowed */
            405: {
                headers: {
                    /** @description Danh sách HTTP methods được hỗ trợ tại path. */
                    Allow?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Conflict */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Unprocessable Content */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Internal Server Error */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    get_api_v1_review_changes: {
        parameters: {
            query?: {
                /** @description Opaque change checkpoint; Server controls fixed order. */
                cursor?: string;
                limit?: number;
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description OK */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["SyncPullResponse"];
                };
            };
            /** @description Bad Request */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Unauthorized */
            401: {
                headers: {
                    /**
                     * @description Bearer challenge cho API được bảo vệ.
                     * @example Bearer realm="pm25-api"
                     */
                    "WWW-Authenticate"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Forbidden */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Method Not Allowed */
            405: {
                headers: {
                    /** @description Danh sách HTTP methods được hỗ trợ tại path. */
                    Allow?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Internal Server Error */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    post_api_v1_review_mutation_batches: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["SyncPushRequest"];
            };
        };
        responses: {
            /** @description OK */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["SyncPushResponse"];
                };
            };
            /** @description Bad Request */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Unauthorized */
            401: {
                headers: {
                    /**
                     * @description Bearer challenge cho API được bảo vệ.
                     * @example Bearer realm="pm25-api"
                     */
                    "WWW-Authenticate"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Forbidden */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Method Not Allowed */
            405: {
                headers: {
                    /** @description Danh sách HTTP methods được hỗ trợ tại path. */
                    Allow?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Unprocessable Content */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Internal Server Error */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Service Unavailable */
            503: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    get_api_v1_exports: {
        parameters: {
            query: {
                datasetId: string;
                /** @description minLon,minLat,maxLon,maxLat (WGS84). */
                bbox?: string;
                /** @description UTC ISO 8601 with Z; range áp dụng cho readings/anomalies. */
                from?: string;
                /** @description UTC ISO 8601 with Z; range áp dụng cho readings/anomalies. */
                to?: string;
                limit?: number;
                /** @description Opaque; gắn với phạm vi export. Đổi bộ lọc phải bỏ cursor và bắt đầu từ trang đầu. */
                cursor?: string;
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description OK */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ExportPage"];
                };
            };
            /** @description Bad Request */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Unauthorized */
            401: {
                headers: {
                    /**
                     * @description Bearer challenge cho API được bảo vệ.
                     * @example Bearer realm="pm25-api"
                     */
                    "WWW-Authenticate"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Forbidden */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Not Found */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Method Not Allowed */
            405: {
                headers: {
                    /** @description Danh sách HTTP methods được hỗ trợ tại path. */
                    Allow?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Conflict */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Unprocessable Content */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Internal Server Error */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    get_api_v1_admin_users: {
        parameters: {
            query?: {
                /** @description Whitelist sort. Backend thêm _id làm tie-breaker (usernameNormalized + _id); cursor chứa khóa cuối và fingerprint filter/sort. */
                sort?: "username:asc" | "username:desc";
                limit?: number;
                /** @description Opaque; gắn với bộ lọc và sort; đổi filter/sort phải bỏ cursor và bắt đầu trang đầu. */
                cursor?: string;
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description OK */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["UserPage"];
                };
            };
            /** @description Bad Request */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Unauthorized */
            401: {
                headers: {
                    /**
                     * @description Bearer challenge cho API được bảo vệ.
                     * @example Bearer realm="pm25-api"
                     */
                    "WWW-Authenticate"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Forbidden */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Method Not Allowed */
            405: {
                headers: {
                    /** @description Danh sách HTTP methods được hỗ trợ tại path. */
                    Allow?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Internal Server Error */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    post_api_v1_admin_users: {
        parameters: {
            query?: never;
            header: {
                /** @description UUID cho một thao tác logic; khi retry phải giữ nguyên key. Không dùng lại key cho thao tác khác. */
                "Idempotency-Key": string;
            };
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["AdminUserCreateRequest"];
            };
        };
        responses: {
            /** @description Created */
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["UserResponse"];
                };
            };
            /** @description Bad Request */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Unauthorized */
            401: {
                headers: {
                    /**
                     * @description Bearer challenge cho API được bảo vệ.
                     * @example Bearer realm="pm25-api"
                     */
                    "WWW-Authenticate"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Forbidden */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Method Not Allowed */
            405: {
                headers: {
                    /** @description Danh sách HTTP methods được hỗ trợ tại path. */
                    Allow?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Conflict */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Unprocessable Content */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Internal Server Error */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    patch_api_v1_admin_users_id: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /** @description ID opaque; API không yêu cầu Client giải mã ObjectId. */
                id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["AdminUserUpdateRequest"];
            };
        };
        responses: {
            /** @description OK */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["UserResponse"];
                };
            };
            /** @description Bad Request */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Unauthorized */
            401: {
                headers: {
                    /**
                     * @description Bearer challenge cho API được bảo vệ.
                     * @example Bearer realm="pm25-api"
                     */
                    "WWW-Authenticate"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Forbidden */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Not Found */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Method Not Allowed */
            405: {
                headers: {
                    /** @description Danh sách HTTP methods được hỗ trợ tại path. */
                    Allow?: string;
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Conflict */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Unprocessable Content */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Internal Server Error */
            500: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
}

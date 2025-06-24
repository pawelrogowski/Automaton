#ifndef ASTAR_WORKER_H
#define ASTAR_WORKER_H

#include <napi.h>
#include <chrono>
#include "pathfinder.h"
#include "aStar.h"

class AStarWorker : public Napi::AsyncWorker {
public:
    AStarWorker(
        Napi::Env env,
        Pathfinder* pathfinderInstance,
        const Node& start,
        const Node& end
    );
    ~AStarWorker();

    void Execute() override;
    void OnOK() override;
    void OnError(const Napi::Error& e) override;
    Napi::Promise GetPromise();
    void Cancel();

private:
    Pathfinder* pathfinder;
    Node startNode;
    Node endNode;
    std::atomic<bool> wasCancelled{false};

    // Result data
    std::vector<Node> pathResult;
    double durationMs;

    // --- CRITICAL FIX: Declare the missing member variable ---
    std::string searchStatus;

    Napi::Promise::Deferred deferred;
};

#endif
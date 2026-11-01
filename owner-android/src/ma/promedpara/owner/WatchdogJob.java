package ma.promedpara.owner;

import android.app.job.JobInfo;
import android.app.job.JobParameters;
import android.app.job.JobScheduler;
import android.app.job.JobService;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.os.Build;

/**
 * A safety net, like the big messaging apps have: every ~15 minutes (and again after the phone restarts) Android runs this job,
 * and if the owner is paired and alerts are on but the alert service was stopped by the phone, it is started again.
 */
public final class WatchdogJob extends JobService {
    static final int ID = 7201;

    static void schedule(Context context) {
        try {
            JobScheduler scheduler = (JobScheduler) context.getSystemService(Context.JOB_SCHEDULER_SERVICE);
            if (scheduler == null) return;
            for (JobInfo job : scheduler.getAllPendingJobs()) if (job.getId() == ID) return;
            scheduler.schedule(new JobInfo.Builder(ID, new ComponentName(context, WatchdogJob.class))
                .setPeriodic(15 * 60 * 1000L).setPersisted(true).setRequiredNetworkType(JobInfo.NETWORK_TYPE_ANY).build());
        } catch (Exception ignored) { /* the app still starts the service itself when opened */ }
    }

    static void cancel(Context context) {
        try { JobScheduler scheduler = (JobScheduler) context.getSystemService(Context.JOB_SCHEDULER_SERVICE); if (scheduler != null) scheduler.cancel(ID); } catch (Exception ignored) { }
    }

    @Override public boolean onStartJob(JobParameters params) {
        try {
            SharedPreferences prefs = getSharedPreferences(MainActivity.PREFS, MODE_PRIVATE);
            if (prefs.getBoolean("monitoring", false) && !prefs.getString("deviceToken", "").isEmpty()) {
                Intent service = new Intent(this, MonitorService.class);
                if (Build.VERSION.SDK_INT >= 26) startForegroundService(service); else startService(service);   // harmless when it already runs
            }
        } catch (Exception ignored) { /* tried again at the next run */ }
        return false;
    }

    @Override public boolean onStopJob(JobParameters params) { return true; }
}

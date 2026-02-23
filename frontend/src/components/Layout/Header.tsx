import React from 'react';

interface HeaderProps {
    children?: React.ReactNode;
}

export function Header({ children }: HeaderProps) {
    return (
        <header className="bg-white shadow-sm border-b border-gray-200">
            <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
                <div className="flex flex-wrap justify-between items-center gap-3 py-3 sm:py-0 sm:h-16">
                    <div className="flex items-center">
                        <h1 className="text-xl sm:text-2xl font-bold text-gray-900">
                            Stellar Token Deployer
                        </h1>
                    </div>
                    <div className="flex items-center gap-2 sm:gap-4 w-full sm:w-auto justify-end">{children}</div>
                </div>
            </div>
        </header>
    );
}
